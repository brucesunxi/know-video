import { getSql } from "@/lib/db";
import { isEditApplicationConflict, materializeAppliedVersion } from "@/lib/edit-application";
import { canPersist } from "@/lib/project-mutations";
import { applySceneStructureMutation, type SceneStructureMutation } from "@/lib/scene-structure";
import type { ChatMessage, Project } from "@/lib/types";

export async function persistSceneStructureMutation(input: {
  project: Project;
  mutation: SceneStructureMutation;
  editPlanId?: string;
}): Promise<{ project: Project; message: ChatMessage; selectedSceneNumber: number }> {
  const result = applySceneStructureMutation(input.project, input.mutation);
  const content = `${result.description} 已保存为可恢复的新版本。`;
  if (!canPersist()) {
    return {
      project: result.project,
      selectedSceneNumber: result.selectedSceneNumber,
      message: {
        id: crypto.randomUUID(),
        role: "assistant",
        type: "version",
        content,
        versionId: result.project.currentVersion.id
      }
    };
  }

  const sql = getSql();
  const materialized = materializeAppliedVersion(result.project);
  const baseVersionId = input.project.currentVersion.id;
  const versionId = materialized.versionId;
  const persistedScenes = materialized.scenes;
  const operationLabel = input.mutation.operation === "set-duration"
    ? `将场景 ${input.mutation.sceneNumber} 调整为 ${input.mutation.durationSeconds} 秒`
    : input.mutation.operation === "move"
      ? `将场景 ${input.mutation.sceneNumber} 向${input.mutation.direction === "earlier" ? "前" : "后"}移动`
      : input.mutation.operation === "duplicate"
        ? `复制场景 ${input.mutation.sceneNumber}`
        : `删除场景 ${input.mutation.sceneNumber}`;

  const queries = [
    sql`
      select id from projects
      where id = ${input.project.id} and current_version_id = ${baseVersionId}
      for update
    `,
    sql`
      update edit_plans set status = 'rejected'
      where project_id = ${input.project.id}
        and base_version_id = ${baseVersionId}
        and status = 'proposed'
        and (${input.editPlanId ?? null}::uuid is null or id <> ${input.editPlanId ?? null}::uuid)
    `,
    ...(input.editPlanId ? [
      sql`
        update edit_plans set status = 'applied'
        where id = ${input.editPlanId}
          and project_id = ${input.project.id}
          and base_version_id = ${baseVersionId}
          and status = 'proposed'
      `
    ] : [
      sql`
        insert into chat_messages (id, project_id, version_id, role, message_type, content)
        select ${materialized.directUserMessageId}, ${input.project.id}, ${baseVersionId}, 'user', 'text', ${operationLabel}
        from projects
        where id = ${input.project.id} and current_version_id = ${baseVersionId}
      `
    ]),
    sql`
      insert into project_versions (
        id, project_id, parent_version_id, status, scene_plan_json, duration_seconds, created_from_message_id
      )
      select
        ${versionId}, ${input.project.id}, ${baseVersionId}, ${result.project.currentVersion.status},
        ${JSON.stringify(persistedScenes)}, ${result.project.currentVersion.durationSeconds}, ${input.editPlanId ? null : materialized.directUserMessageId}
      from projects
      where id = ${input.project.id} and current_version_id = ${baseVersionId}
        and (${input.editPlanId ?? null}::uuid is null or exists (
          select 1 from edit_plans where id = ${input.editPlanId ?? null}::uuid and status = 'applied'
        ))
    `,
    ...persistedScenes.flatMap((scene) => [
      sql`
        insert into scenes (
          id, version_id, scene_number, title, voiceover, visual_prompt, motion_prompt, duration_seconds, style_json
        ) values (
          ${scene.id}, ${versionId}, ${scene.sceneNumber}, ${scene.title}, ${scene.voiceover},
          ${scene.visualPrompt}, ${scene.motionPrompt}, ${scene.durationSeconds}, ${JSON.stringify(scene.style)}
        )
      `,
      ...scene.assets.map((asset) => sql`
        insert into scene_assets (id, scene_id, asset_type, r2_key, public_url, metadata_json)
        values (
          ${asset.id}, ${scene.id}, ${asset.type}, ${asset.r2Key}, ${asset.url}, ${JSON.stringify(asset.metadata ?? {})}
        )
      `)
    ]),
    sql`
      update projects
      set current_version_id = ${versionId}, updated_at = now()
      where id = ${input.project.id} and current_version_id = ${baseVersionId}
    `,
    sql`
      insert into chat_messages (id, project_id, version_id, role, message_type, content)
      values (${materialized.assistantMessageId}, ${input.project.id}, ${versionId}, 'assistant', 'version', ${content})
    `
  ];

  try {
    await sql.transaction(queries);
  } catch (error) {
    if (isEditApplicationConflict(error)) {
      throw new Error("视频版本已经发生变化，请刷新后重新调整时间线。");
    }
    throw error;
  }

  return {
    selectedSceneNumber: result.selectedSceneNumber,
    project: {
      ...result.project,
      currentVersion: {
        ...result.project.currentVersion,
        id: versionId,
        scenes: persistedScenes
      }
    },
    message: {
      id: materialized.assistantMessageId,
      role: "assistant",
      type: "version",
      content,
      versionId
    }
  };
}
