import { getSql, hasDatabaseUrl } from "@/lib/db";
import { generateProjectSceneImages } from "@/lib/image-assets";
import { assetUrlForKey } from "@/lib/r2";
import { applyEditPlan } from "@/lib/video-brain";
import type { ChatMessage, EditPlan, Project, ProjectVersion, Scene, SceneAsset } from "@/lib/types";

type IdRow = { id: string };

export function canPersist() {
  return hasDatabaseUrl();
}

function versionStatus(project: Project): ProjectVersion["status"] {
  return project.currentVersion.assetStatus === "failed" ? "failed" : "ready";
}

async function insertScenes(versionId: string, scenes: Scene[]) {
  const sql = getSql();

  for (const scene of scenes) {
    const sceneRows = await sql`
      insert into scenes (
        version_id,
        scene_number,
        title,
        voiceover,
        visual_prompt,
        motion_prompt,
        duration_seconds,
        style_json
      )
      values (
        ${versionId},
        ${scene.sceneNumber},
        ${scene.title},
        ${scene.voiceover},
        ${scene.visualPrompt},
        ${scene.motionPrompt},
        ${scene.durationSeconds},
        ${JSON.stringify(scene.style)}
      )
      returning id
    ` as IdRow[];

    const sceneId = sceneRows[0]?.id;
    if (!sceneId || scene.assets.length === 0) continue;

    for (const asset of scene.assets) {
      await sql`
        insert into scene_assets (
          scene_id,
          asset_type,
          r2_key,
          public_url,
          metadata_json
        )
        values (
          ${sceneId},
          ${asset.type},
          ${asset.r2Key},
          ${asset.url},
          ${JSON.stringify(asset.metadata ?? {})}
        )
      `;
    }
  }
}

async function loadSceneAssets(sceneIds: string[]) {
  if (sceneIds.length === 0) return new Map<string, SceneAsset[]>();

  const sql = getSql();
  const rows = await sql`
    select id, scene_id, asset_type, r2_key, public_url, metadata_json
    from scene_assets
    where scene_id = any(${sceneIds})
    order by created_at asc
  ` as Array<{
    id: string;
    scene_id: string;
    asset_type: SceneAsset["type"];
    r2_key: string;
    public_url: string | null;
    metadata_json: unknown;
  }>;

  const byScene = new Map<string, SceneAsset[]>();
  for (const row of rows) {
    const current = byScene.get(row.scene_id) ?? [];
    current.push({
      id: row.id,
      type: row.asset_type,
      r2Key: row.r2_key,
      url: assetUrlForKey(row.r2_key, row.public_url ?? undefined),
      metadata: row.metadata_json && typeof row.metadata_json === "object"
        ? row.metadata_json as Record<string, unknown>
        : {}
    });
    byScene.set(row.scene_id, current);
  }

  return byScene;
}

export async function persistGeneratedProject(params: {
  prompt: string;
  project: Project;
  engine: string;
}): Promise<{ project: Project; messages: ChatMessage[] }> {
  if (!canPersist()) {
    const messages: ChatMessage[] = [
      {
        id: crypto.randomUUID(),
        role: "user",
        type: "text",
        content: params.prompt
      },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        type: "version",
        content: params.project.currentVersion.assetStatus === "ready"
          ? `已完成 ${params.project.currentVersion.scenes.length} 个场景和全部视觉素材。`
          : `已完成 ${params.project.currentVersion.scenes.length} 个场景，但部分视觉素材需要重试。`,
        versionId: params.project.currentVersion.id
      }
    ];
    return { project: params.project, messages };
  }

  const sql = getSql();
  const status = versionStatus(params.project);
  const projectRows = await sql`
    insert into projects (title)
    values (${params.project.title})
    returning id
  ` as IdRow[];
  const projectId = projectRows[0].id;

  const versionRows = await sql`
    insert into project_versions (
      project_id,
      status,
      scene_plan_json,
      duration_seconds
    )
    values (
      ${projectId},
      ${status},
      ${JSON.stringify(params.project.currentVersion.scenes)},
      ${params.project.currentVersion.durationSeconds}
    )
    returning id
  ` as IdRow[];
  const versionId = versionRows[0].id;

  await insertScenes(versionId, params.project.currentVersion.scenes);

  await sql`
    update projects
    set current_version_id = ${versionId}, updated_at = now()
    where id = ${projectId}
  `;

  const userRows = await sql`
    insert into chat_messages (project_id, version_id, role, message_type, content)
    values (${projectId}, ${versionId}, 'user', 'text', ${params.prompt})
    returning id
  ` as IdRow[];

  const assistantContent = params.project.currentVersion.assetStatus === "ready"
    ? `已完成 ${params.project.currentVersion.scenes.length} 个场景和全部视觉素材。你可以播放预览，或通过对话逐场景修改。`
    : `已完成 ${params.project.currentVersion.scenes.length} 个场景，但视觉素材没有全部生成。请在工作室中重试缺失的场景。`;
  const assistantRows = await sql`
    insert into chat_messages (project_id, version_id, role, message_type, content)
    values (${projectId}, ${versionId}, 'assistant', 'version', ${assistantContent})
    returning id
  ` as IdRow[];

  const project: Project = {
    ...params.project,
    id: projectId,
    currentVersion: {
      ...params.project.currentVersion,
      id: versionId,
      status,
      scenes: params.project.currentVersion.scenes
    }
  };

  return {
    project,
    messages: [
      {
        id: userRows[0].id,
        role: "user",
        type: "text",
        content: params.prompt,
        versionId
      },
      {
        id: assistantRows[0].id,
        role: "assistant",
        type: "version",
        content: assistantContent,
        versionId
      }
    ]
  };
}

export async function loadVersion(versionId: string): Promise<ProjectVersion | undefined> {
  if (!canPersist()) return undefined;

  const sql = getSql();
  const versions = await sql`
    select id, status, duration_seconds, render_url, created_at
    from project_versions
    where id = ${versionId}
    limit 1
  ` as Array<{
    id: string;
    status: ProjectVersion["status"];
    duration_seconds: number;
    render_url: string | null;
    created_at: Date | string;
  }>;

  const version = versions[0];
  if (!version) return undefined;

  const scenes = await sql`
    select id, scene_number, title, voiceover, visual_prompt, motion_prompt, duration_seconds, style_json
    from scenes
    where version_id = ${versionId}
    order by scene_number asc
  ` as Array<{
    id: string;
    scene_number: number;
    title: string;
    voiceover: string;
    visual_prompt: string;
    motion_prompt: string;
    duration_seconds: number;
    style_json: unknown;
  }>;

  const assetMap = await loadSceneAssets(scenes.map((scene) => scene.id));
  const hydratedScenes = scenes.map((scene) => ({
    id: scene.id,
    sceneNumber: scene.scene_number,
    title: scene.title,
    voiceover: scene.voiceover,
    visualPrompt: scene.visual_prompt,
    motionPrompt: scene.motion_prompt,
    durationSeconds: scene.duration_seconds,
    style: scene.style_json as Scene["style"],
    assets: assetMap.get(scene.id) ?? []
  }));
  const imageCount = hydratedScenes.filter((scene) => scene.assets.some((asset) => asset.type === "image")).length;

  return {
    id: version.id,
    label: "current",
    status: version.status,
    createdAt: new Date(version.created_at).toISOString(),
    durationSeconds: version.duration_seconds,
    renderUrl: version.render_url ?? undefined,
    assetStatus: imageCount === hydratedScenes.length ? "ready" : imageCount > 0 ? "partial" : "failed",
    scenes: hydratedScenes
  };
}

export async function persistGeneratedSceneAssets(versionId: string, scenes: Scene[]) {
  if (!canPersist()) return;

  const sql = getSql();
  const rows = await sql`
    select id, scene_number
    from scenes
    where version_id = ${versionId}
  ` as Array<{ id: string; scene_number: number }>;
  const sceneIdByNumber = new Map(rows.map((row) => [row.scene_number, row.id]));

  for (const scene of scenes) {
    const sceneId = sceneIdByNumber.get(scene.sceneNumber);
    if (!sceneId) continue;

    for (const asset of scene.assets.filter((item) => item.type === "image")) {
      await sql`
        insert into scene_assets (scene_id, asset_type, r2_key, public_url, metadata_json)
        select ${sceneId}, ${asset.type}, ${asset.r2Key}, ${asset.url}, ${JSON.stringify(asset.metadata ?? {})}
        where not exists (
          select 1 from scene_assets where scene_id = ${sceneId} and r2_key = ${asset.r2Key}
        )
      `;
    }
  }

  const imageCount = scenes.filter((scene) => scene.assets.some((asset) => asset.type === "image")).length;
  await sql`
    update project_versions
    set status = ${imageCount > 0 ? "ready" : "failed"}
    where id = ${versionId}
  `;
}

export async function persistEditPlan(params: {
  projectId: string;
  request: string;
  versionId: string;
  editPlan: EditPlan;
  engine: string;
}): Promise<{ editPlan: EditPlan; messages: ChatMessage[] }> {
  if (!canPersist()) {
    return {
      editPlan: params.editPlan,
      messages: [
        { id: crypto.randomUUID(), role: "user", type: "text", content: params.request },
        { id: crypto.randomUUID(), role: "assistant", type: "plan", content: params.editPlan.summary, editPlan: params.editPlan }
      ]
    };
  }

  const sql = getSql();
  const userRows = await sql`
    insert into chat_messages (project_id, version_id, role, message_type, content)
    values (${params.projectId}, ${params.versionId}, 'user', 'text', ${params.request})
    returning id
  ` as IdRow[];

  const planRows = await sql`
    insert into edit_plans (
      project_id,
      base_version_id,
      user_message_id,
      status,
      summary,
      affected_scenes_json,
      patch_json,
      preview_json
    )
    values (
      ${params.projectId},
      ${params.versionId},
      ${userRows[0].id},
      'proposed',
      ${params.editPlan.summary},
      ${JSON.stringify(params.editPlan.affectedScenes)},
      ${JSON.stringify(params.editPlan)},
      ${JSON.stringify({ engine: params.engine })}
    )
    returning id
  ` as IdRow[];

  const editPlan: EditPlan = {
    ...params.editPlan,
    id: planRows[0].id,
    baseVersionId: params.versionId
  };

  const assistantRows = await sql`
    insert into chat_messages (project_id, version_id, role, message_type, content, metadata_json)
    values (
      ${params.projectId},
      ${params.versionId},
      'assistant',
      'plan',
      ${editPlan.summary},
      ${JSON.stringify({ editPlan, engine: params.engine })}
    )
    returning id
  ` as IdRow[];

  return {
    editPlan,
    messages: [
      { id: userRows[0].id, role: "user", type: "text", content: params.request, versionId: params.versionId },
      { id: assistantRows[0].id, role: "assistant", type: "plan", content: editPlan.summary, versionId: params.versionId, editPlan }
    ]
  };
}

export async function applyPersistedEditPlan(params: {
  project: Project;
  editPlan: EditPlan;
}): Promise<{ project: Project; message: ChatMessage; renderJobId?: string }> {
  const nextProject = await generateProjectSceneImages(
    applyEditPlan(params.project, params.editPlan),
    {
      replaceExistingImages: true,
      sceneNumbers: params.editPlan.affectedScenes
    }
  );

  if (!canPersist()) {
    return {
      project: nextProject,
      message: {
        id: crypto.randomUUID(),
        role: "assistant",
        type: "version",
        content: `${nextProject.currentVersion.label} applied · render job queued`,
        versionId: nextProject.currentVersion.id
      },
      renderJobId: crypto.randomUUID()
    };
  }

  const sql = getSql();
  const versionRows = await sql`
    insert into project_versions (
      project_id,
      parent_version_id,
      status,
      scene_plan_json,
      duration_seconds
    )
    values (
      ${params.project.id},
      ${params.project.currentVersion.id},
      ${versionStatus(nextProject)},
      ${JSON.stringify(nextProject.currentVersion.scenes)},
      ${nextProject.currentVersion.durationSeconds}
    )
    returning id
  ` as IdRow[];
  const versionId = versionRows[0].id;

  await insertScenes(versionId, nextProject.currentVersion.scenes);

  await sql`
    update projects
    set current_version_id = ${versionId}, updated_at = now()
    where id = ${params.project.id}
  `;

  await sql`
    update edit_plans
    set status = 'applied'
    where id = ${params.editPlan.id}
  `;

  const jobRows = await sql`
    insert into render_jobs (project_id, version_id, status, progress)
    values (${params.project.id}, ${versionId}, 'queued', 0)
    returning id
  ` as IdRow[];

  const content = `${nextProject.currentVersion.label} applied · render job ${jobRows[0].id.slice(0, 8)} queued`;
  const messageRows = await sql`
    insert into chat_messages (project_id, version_id, role, message_type, content)
    values (${params.project.id}, ${versionId}, 'assistant', 'version', ${content})
    returning id
  ` as IdRow[];

  return {
    project: {
      ...nextProject,
      currentVersion: {
        ...nextProject.currentVersion,
        id: versionId
      }
    },
    message: {
      id: messageRows[0].id,
      role: "assistant",
      type: "version",
      content,
      versionId
    },
    renderJobId: jobRows[0].id
  };
}
