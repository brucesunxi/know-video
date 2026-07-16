import { getSql, hasDatabaseUrl } from "@/lib/db";
import { isEditApplicationConflict, materializeAppliedVersion } from "@/lib/edit-application";
import { editPlanSchema } from "@/lib/edit-plan-schema";
import { normalizeEditPlanAgainstScenes } from "@/lib/edit-plan-normalizer";
import { demoProject } from "@/lib/mock-data";
import { initialVersionStatus, materializeNewProject } from "@/lib/project-creation";
import { assetUrlForKey } from "@/lib/r2";
import { invalidateVersionRender } from "@/lib/render-jobs";
import { deleteUnreferencedStorageObjects } from "@/lib/storage-cleanup";
import { assertRestorableVersion, restorableSceneAssets, restoredVersionStatus } from "@/lib/version-restore";
import { applyEditPlan } from "@/lib/video-brain";
import type { ChatMessage, EditPlan, Project, ProjectVersion, ProjectVersionSummary, Scene, SceneAsset } from "@/lib/types";

type IdRow = { id: string };

export function canPersist() {
  return hasDatabaseUrl();
}

function versionStatus(project: Project): ProjectVersion["status"] {
  if (project.currentVersion.assetStatus === "failed") return "failed";
  return project.currentVersion.assetStatus === "ready" ? "ready" : "draft";
}

async function loadSceneAssets(sceneIds: string[]) {
  if (sceneIds.length === 0) return new Map<string, SceneAsset[]>();

  const sql = getSql();
  const rows = await sql`
    select id, scene_id, asset_type, r2_key, public_url, metadata_json
    from scene_assets
    where scene_id = any(${sceneIds})
    order by created_at desc
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
        content: `脚本和 ${params.project.currentVersion.scenes.length} 个分镜已经完成，正在继续生成画面与配音。`,
        versionId: params.project.currentVersion.id
      }
    ];
    return { project: params.project, messages };
  }

  const sql = getSql();
  const status = initialVersionStatus(params.project);
  const materialized = materializeNewProject(params.project);
  const {
    projectId,
    versionId,
    userMessageId,
    assistantMessageId,
    scenes: persistedScenes
  } = materialized;
  const assistantContent = `脚本和 ${params.project.currentVersion.scenes.length} 个分镜已经完成，正在继续生成画面与配音。`;
  const queries = [
    sql`
      insert into projects (id, title)
      values (${projectId}, ${params.project.title})
    `,
    sql`
      insert into project_versions (
        id,
        project_id,
        status,
        scene_plan_json,
        duration_seconds
      )
      values (
        ${versionId},
        ${projectId},
        ${status},
        ${JSON.stringify(persistedScenes)},
        ${params.project.currentVersion.durationSeconds}
      )
    `,
    ...persistedScenes.flatMap((scene) => [
      sql`
        insert into scenes (
          id,
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
          ${scene.id},
          ${versionId},
          ${scene.sceneNumber},
          ${scene.title},
          ${scene.voiceover},
          ${scene.visualPrompt},
          ${scene.motionPrompt},
          ${scene.durationSeconds},
          ${JSON.stringify(scene.style)}
        )
      `,
      ...scene.assets.map((asset) => sql`
        insert into scene_assets (
          id,
          scene_id,
          asset_type,
          r2_key,
          public_url,
          metadata_json
        )
        values (
          ${asset.id},
          ${scene.id},
          ${asset.type},
          ${asset.r2Key},
          ${asset.url},
          ${JSON.stringify(asset.metadata ?? {})}
        )
      `)
    ]),
    sql`
      update projects
      set current_version_id = ${versionId}, updated_at = now()
      where id = ${projectId}
    `,
    sql`
      insert into chat_messages (id, project_id, version_id, role, message_type, content)
      values (${userMessageId}, ${projectId}, ${versionId}, 'user', 'text', ${params.prompt})
    `,
    sql`
      insert into chat_messages (id, project_id, version_id, role, message_type, content)
      values (${assistantMessageId}, ${projectId}, ${versionId}, 'assistant', 'version', ${assistantContent})
    `
  ];
  await sql.transaction(queries);

  const project: Project = {
    ...params.project,
    id: projectId,
    currentVersion: {
      ...params.project.currentVersion,
      id: versionId,
      status,
      scenes: persistedScenes
    }
  };

  return {
    project,
    messages: [
      {
        id: userMessageId,
        role: "user",
        type: "text",
        content: params.prompt,
        versionId
      },
      {
        id: assistantMessageId,
        role: "assistant",
        type: "version",
        content: assistantContent,
        versionId
      }
    ]
  };
}

export async function loadProjectForRender(projectId: string, versionId: string): Promise<Project | undefined> {
  if (!canPersist()) return undefined;
  const sql = getSql();
  const rows = await sql`
    select p.title
    from projects p
    join project_versions pv on pv.project_id = p.id
    where p.id = ${projectId} and pv.id = ${versionId}
    limit 1
  ` as Array<{ title: string }>;
  if (!rows[0]) return undefined;
  const version = await loadVersion(versionId);
  if (!version) return undefined;
  return {
    id: projectId,
    title: rows[0].title,
    engine: "Animation Engine",
    credits: 0,
    plan: "Free",
    currentVersion: version
  };
}

export async function loadCurrentProjectForEdit(projectId: string, versionId: string) {
  if (!canPersist()) {
    return projectId === demoProject.id && versionId === demoProject.currentVersion.id
      ? demoProject
      : undefined;
  }
  const rows = await getSql()`
    select id
    from projects
    where id = ${projectId} and current_version_id = ${versionId}
    limit 1
  ` as IdRow[];
  if (!rows[0]) return undefined;
  return loadProjectForRender(projectId, versionId);
}

export async function loadVersion(versionId: string): Promise<ProjectVersion | undefined> {
  if (!canPersist()) return undefined;

  const sql = getSql();
  const versions = await sql`
    select
      pv.id,
      pv.parent_version_id,
      pv.status,
      pv.duration_seconds,
      pv.render_url,
      pv.created_at,
      (
        select rj.id
        from render_jobs rj
        where rj.version_id = pv.id
          and rj.status in ('queued', 'running')
        order by rj.created_at desc
        limit 1
      ) as active_render_job_id
    from project_versions pv
    where pv.id = ${versionId}
    limit 1
  ` as Array<{
    id: string;
    parent_version_id: string | null;
    status: ProjectVersion["status"];
    duration_seconds: number;
    render_url: string | null;
    active_render_job_id: string | null;
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
  const visualCount = hydratedScenes.filter((scene) => scene.assets.some((asset) => ["image", "clip"].includes(asset.type))).length;
  const audioCount = hydratedScenes.filter((scene) => scene.assets.some((asset) => asset.type === "audio")).length;
  const mediaComplete = hydratedScenes.length > 0
    && visualCount === hydratedScenes.length
    && audioCount === hydratedScenes.length;
  const status = ["planning", "rendering", "failed"].includes(version.status)
    ? version.status
    : mediaComplete
      ? "ready"
      : "draft";

  return {
    id: version.id,
    parentVersionId: version.parent_version_id ?? undefined,
    label: "current",
    status,
    createdAt: new Date(version.created_at).toISOString(),
    durationSeconds: version.duration_seconds,
    renderUrl: version.render_url ?? undefined,
    renderJobId: version.active_render_job_id ?? undefined,
    assetStatus: visualCount === hydratedScenes.length ? "ready" : visualCount > 0 ? "partial" : "failed",
    scenes: hydratedScenes
  };
}

export async function persistGeneratedSceneAssets(
  versionId: string,
  scenes: Scene[],
  options: { replaceAudio?: boolean; replaceImages?: boolean; sceneNumbers?: number[] } = {}
) {
  if (!canPersist()) return;

  const sql = getSql();
  const rows = await sql`
    select id, scene_number
    from scenes
    where version_id = ${versionId}
  ` as Array<{ id: string; scene_number: number }>;
  const sceneIdByNumber = new Map(rows.map((row) => [row.scene_number, row.id]));
  const selected = options.sceneNumbers ? new Set(options.sceneNumbers) : undefined;
  const queries = [];
  const deletionIndexes: number[] = [];

  for (const scene of scenes) {
    if (selected && !selected.has(scene.sceneNumber)) continue;
    const sceneId = sceneIdByNumber.get(scene.sceneNumber);
    if (!sceneId) continue;

    if (options.replaceAudio) {
      deletionIndexes.push(queries.length);
      queries.push(sql`
        delete from scene_assets
        where scene_id = ${sceneId} and asset_type = 'audio'
        returning r2_key
      `);
    }
    if (options.replaceImages) {
      deletionIndexes.push(queries.length);
      queries.push(sql`
        delete from scene_assets
        where scene_id = ${sceneId} and asset_type in ('image', 'clip')
        returning r2_key
      `);
    }

    for (const asset of scene.assets) {
      queries.push(sql`
        insert into scene_assets (scene_id, asset_type, r2_key, public_url, metadata_json)
        select ${sceneId}, ${asset.type}, ${asset.r2Key}, ${asset.url}, ${JSON.stringify(asset.metadata ?? {})}
        where not exists (
          select 1 from scene_assets where scene_id = ${sceneId} and r2_key = ${asset.r2Key}
        )
      `);
    }
  }

  const results = queries.length > 0
    ? await sql.transaction(queries)
    : [];
  const replacedKeys = deletionIndexes.flatMap((index) => (
    results[index] as Array<{ r2_key: string }> | undefined
  )?.map((row) => row.r2_key) ?? []);

  await invalidateVersionRender(versionId);
  const counts = await sql`
    select
      count(*)::int as scene_count,
      count(*) filter (
        where exists (
          select 1 from scene_assets sa where sa.scene_id = scenes.id and sa.asset_type in ('image', 'clip')
        )
      )::int as visual_count,
      count(*) filter (
        where exists (
          select 1 from scene_assets sa where sa.scene_id = scenes.id and sa.asset_type = 'audio'
        )
      )::int as audio_count
    from scenes
    where version_id = ${versionId}
  ` as Array<{ scene_count: number; visual_count: number; audio_count: number }>;
  const complete = (counts[0]?.scene_count ?? 0) > 0
    && counts[0]?.scene_count === counts[0]?.visual_count
    && counts[0]?.scene_count === counts[0]?.audio_count;
  await sql`
    update project_versions
    set status = ${complete ? "ready" : "draft"}
    where id = ${versionId}
  `;
  await deleteUnreferencedStorageObjects(replacedKeys).catch((error) => {
    console.error("[project-mutations] Unable to clean replaced generated assets:", error);
  });
}

export async function rejectPersistedEditPlan(params: {
  projectId: string;
  versionId: string;
  editPlanId: string;
}): Promise<ChatMessage> {
  const content = "已取消这份修改方案，当前视频版本保持不变。";
  if (!canPersist()) {
    return { id: crypto.randomUUID(), role: "assistant", type: "text", content, versionId: params.versionId };
  }
  const sql = getSql();
  const rejected = await sql`
    update edit_plans set status = 'rejected'
    where id = ${params.editPlanId}
      and project_id = ${params.projectId}
      and base_version_id = ${params.versionId}
      and status = 'proposed'
    returning id
  ` as IdRow[];
  if (!rejected[0]) throw new Error("修改方案已经失效，无需再次取消。");
  const rows = await sql`
    insert into chat_messages (project_id, version_id, role, message_type, content)
    values (${params.projectId}, ${params.versionId}, 'assistant', 'text', ${content})
    returning id
  ` as IdRow[];
  return { id: rows[0].id, role: "assistant", type: "text", content, versionId: params.versionId };
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
  await sql`
    update edit_plans
    set status = 'rejected'
    where project_id = ${params.projectId}
      and base_version_id = ${params.versionId}
      and status = 'proposed'
  `;
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

export async function loadProposedEditPlan(params: {
  projectId: string;
  versionId: string;
  editPlanId: string;
}) {
  if (!canPersist()) return undefined;
  const rows = await getSql()`
    select id, base_version_id, patch_json, created_at
    from edit_plans
    where id = ${params.editPlanId}
      and project_id = ${params.projectId}
      and base_version_id = ${params.versionId}
      and status = 'proposed'
    limit 1
  ` as Array<{
    id: string;
    base_version_id: string;
    patch_json: unknown;
    created_at: Date | string;
  }>;
  const row = rows[0];
  if (!row) return undefined;
  const parsed = editPlanSchema.safeParse(row.patch_json);
  if (!parsed.success) {
    throw new Error("修改方案数据不完整，请重新生成。");
  }
  return {
    ...parsed.data,
    id: row.id,
    baseVersionId: row.base_version_id,
    status: "proposed" as const,
    createdAt: new Date(row.created_at).toISOString()
  } satisfies EditPlan;
}

export async function applyPersistedEditPlan(params: {
  project: Project;
  editPlan: EditPlan;
  direct?: boolean;
}): Promise<{
  project: Project;
  message: ChatMessage;
  regeneration: { imageSceneNumbers: number[]; audioSceneNumbers: number[] };
}> {
  const normalizedPlan = normalizeEditPlanAgainstScenes(
    params.editPlan,
    params.project.currentVersion.scenes
  );
  const normalizedChanges = normalizedPlan.changes;
  if (normalizedChanges.length === 0) {
    throw new Error("修改方案没有产生实际变化，请换一种说法后重新生成。");
  }
  const changedProject = applyEditPlan(params.project, normalizedPlan);
  const imageSceneNumbers = normalizedChanges
    .filter((change) => change.regenerate.includes("image"))
    .map((change) => change.sceneNumber);
  const audioSceneNumbers = normalizedChanges
    .filter((change) => change.regenerate.includes("audio"))
    .map((change) => change.sceneNumber);
  const captionSceneNumbers = normalizedChanges
    .filter((change) => change.regenerate.includes("caption"))
    .map((change) => change.sceneNumber);
  const imageTargets = new Set(imageSceneNumbers);
  const audioTargets = new Set(audioSceneNumbers);
  const captionTargets = new Set(captionSceneNumbers);
  const scenes = changedProject.currentVersion.scenes.map((scene) => ({
    ...scene,
    assets: scene.assets.filter((asset) => {
      if (asset.type === "render") return false;
      if (imageTargets.has(scene.sceneNumber) && ["image", "clip", "thumbnail"].includes(asset.type)) return false;
      if (audioTargets.has(scene.sceneNumber) && asset.type === "audio") return false;
      if (captionTargets.has(scene.sceneNumber) && asset.type === "caption") return false;
      return true;
    })
  }));
  const visualCount = scenes.filter((scene) => scene.assets.some((asset) => ["image", "clip"].includes(asset.type))).length;
  const nextProject: Project = {
    ...changedProject,
    currentVersion: {
      ...changedProject.currentVersion,
      status: "draft",
      renderUrl: undefined,
      assetStatus: visualCount === scenes.length ? "ready" : visualCount > 0 ? "partial" : "failed",
      assetErrorCode: undefined,
      scenes
    }
  };
  const regeneration = { imageSceneNumbers, audioSceneNumbers };
  const pendingMedia = imageSceneNumbers.length > 0 || audioSceneNumbers.length > 0;

  if (!canPersist()) {
    return {
      project: nextProject,
      message: {
        id: crypto.randomUUID(),
        role: "assistant",
        type: "version",
        content: pendingMedia
          ? "修改已保存为可恢复的新版本，正在刷新受影响的画面和配音。"
          : "修改已保存为可恢复的新版本，可以继续预览或导出。",
        versionId: nextProject.currentVersion.id
      },
      regeneration
    };
  }

  const sql = getSql();
  const materialized = materializeAppliedVersion(nextProject);
  const {
    versionId,
    assistantMessageId,
    directUserMessageId,
    scenes: persistedScenes
  } = materialized;
  const content = pendingMedia
    ? "修改已保存为可恢复的新版本，正在刷新受影响的画面和配音。"
    : "修改已保存为可恢复的新版本，可以继续预览或导出。";
  const baseVersionId = params.project.currentVersion.id;
  const queries = [
    sql`
      select id
      from projects
      where id = ${params.project.id}
        and current_version_id = ${baseVersionId}
      for update
    `,
    ...(params.direct ? [
      sql`
        update edit_plans
        set status = 'rejected'
        where project_id = ${params.project.id}
          and base_version_id = ${baseVersionId}
          and status = 'proposed'
      `,
      sql`
        insert into chat_messages (id, project_id, version_id, role, message_type, content)
        values (
          ${directUserMessageId},
          ${params.project.id},
          ${baseVersionId},
          'user',
          'text',
          ${normalizedPlan.userRequest}
        )
      `,
      sql`
        insert into edit_plans (
          id,
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
          ${normalizedPlan.id},
          ${params.project.id},
          ${baseVersionId},
          ${directUserMessageId},
          'proposed',
          ${normalizedPlan.summary},
          ${JSON.stringify(normalizedPlan.affectedScenes)},
          ${JSON.stringify(normalizedPlan)},
          ${JSON.stringify({ source: "direct-scene-edit" })}
        )
      `
    ] : []),
    sql`
      with claimed_plan as (
        update edit_plans
        set status = 'applied'
        where id = ${normalizedPlan.id}
          and project_id = ${params.project.id}
          and base_version_id = ${baseVersionId}
          and status = 'proposed'
          and exists (
            select 1
            from projects
            where id = ${params.project.id}
              and current_version_id = ${baseVersionId}
          )
        returning id
      )
      insert into project_versions (
        id,
        project_id,
        parent_version_id,
        status,
        scene_plan_json,
        duration_seconds
      )
      select
        ${versionId},
        ${params.project.id},
        ${baseVersionId},
        ${pendingMedia ? "draft" : versionStatus(nextProject)},
        ${JSON.stringify(persistedScenes)},
        ${nextProject.currentVersion.durationSeconds}
      from claimed_plan
    `,
    ...persistedScenes.flatMap((scene) => [
      sql`
        insert into scenes (
          id,
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
          ${scene.id},
          ${versionId},
          ${scene.sceneNumber},
          ${scene.title},
          ${scene.voiceover},
          ${scene.visualPrompt},
          ${scene.motionPrompt},
          ${scene.durationSeconds},
          ${JSON.stringify(scene.style)}
        )
      `,
      ...scene.assets.map((asset) => sql`
        insert into scene_assets (
          id,
          scene_id,
          asset_type,
          r2_key,
          public_url,
          metadata_json
        )
        values (
          ${asset.id},
          ${scene.id},
          ${asset.type},
          ${asset.r2Key},
          ${asset.url},
          ${JSON.stringify(asset.metadata ?? {})}
        )
      `)
    ]),
    sql`
      update projects
      set current_version_id = ${versionId}, updated_at = now()
      where id = ${params.project.id}
        and current_version_id = ${baseVersionId}
    `,
    sql`
      insert into chat_messages (id, project_id, version_id, role, message_type, content)
      values (
        ${assistantMessageId},
        ${params.project.id},
        ${versionId},
        'assistant',
        'version',
        ${content}
      )
    `
  ];
  try {
    await sql.transaction(queries);
  } catch (error) {
    if (isEditApplicationConflict(error)) {
      throw new Error("修改方案已经失效，或视频版本已经发生变化，请刷新后重新生成。");
    }
    throw error;
  }

  return {
    project: {
      ...nextProject,
      currentVersion: {
        ...nextProject.currentVersion,
        id: versionId,
        scenes: persistedScenes
      }
    },
    message: {
      id: assistantMessageId,
      role: "assistant",
      type: "version",
      content,
      versionId
    },
    regeneration
  };
}

export async function listProjectVersions(projectId: string): Promise<ProjectVersionSummary[]> {
  if (!canPersist()) return [];
  const sql = getSql();
  const rows = await sql`
    select
      pv.id,
      pv.parent_version_id,
      pv.status,
      pv.duration_seconds,
      pv.render_url,
      pv.created_at,
      p.current_version_id,
      count(s.id)::int as scene_count,
      count(s.id) filter (
        where exists (
          select 1
          from scene_assets visual_asset
          where visual_asset.scene_id = s.id
            and visual_asset.asset_type in ('image', 'clip')
        )
      )::int as visual_count,
      count(s.id) filter (
        where exists (
          select 1
          from scene_assets audio_asset
          where audio_asset.scene_id = s.id
            and audio_asset.asset_type = 'audio'
        )
      )::int as audio_count,
      exists (
        select 1
        from render_jobs active_render
        where active_render.project_id = pv.project_id
          and active_render.version_id = pv.id
          and active_render.status in ('queued', 'running')
      ) as has_active_render
    from project_versions pv
    join projects p on p.id = pv.project_id
    left join scenes s on s.version_id = pv.id
    where pv.project_id = ${projectId}
    group by pv.id, p.current_version_id
    order by pv.created_at desc
  ` as Array<{
    id: string;
    parent_version_id: string | null;
    status: ProjectVersion["status"];
    duration_seconds: number;
    render_url: string | null;
    created_at: Date | string;
    current_version_id: string | null;
    scene_count: number;
    visual_count: number;
    audio_count: number;
    has_active_render: boolean;
  }>;
  return rows.map((row, index) => {
    const mediaComplete = row.scene_count > 0
      && row.visual_count === row.scene_count
      && row.audio_count === row.scene_count;
    const status: ProjectVersion["status"] = row.has_active_render
      ? "rendering"
      : row.status === "planning"
        ? "planning"
        : row.status === "failed"
          ? "failed"
          : mediaComplete
            ? "ready"
            : "draft";

    return {
      id: row.id,
      parentVersionId: row.parent_version_id ?? undefined,
      label: `版本 ${rows.length - index}`,
      status,
      createdAt: new Date(row.created_at).toISOString(),
      durationSeconds: row.duration_seconds,
      renderUrl: row.render_url ?? undefined,
      sceneCount: row.scene_count,
      isCurrent: row.id === row.current_version_id
    };
  });
}

export async function restoreProjectVersion(params: {
  projectId: string;
  targetVersionId: string;
}): Promise<{ project: Project; message: ChatMessage }> {
  if (!canPersist()) throw new Error("版本恢复需要数据库连接。");
  const sql = getSql();
  const ownership = await sql`
    select
      p.title,
      p.current_version_id,
      target.project_id as target_project_id
    from projects p
    left join project_versions target on target.id = ${params.targetVersionId}
    where p.id = ${params.projectId}
    limit 1
  ` as Array<{
    title: string;
    current_version_id: string | null;
    target_project_id: string | null;
  }>;
  const projectRow = ownership[0];
  if (!projectRow?.current_version_id) throw new Error("没有找到项目。");
  if (!projectRow.target_project_id) throw new Error("没有找到要恢复的版本。");
  assertRestorableVersion({
    projectId: params.projectId,
    targetProjectId: projectRow.target_project_id,
    currentVersionId: projectRow.current_version_id,
    targetVersionId: params.targetVersionId
  });
  const target = await loadVersion(params.targetVersionId);
  if (!target) throw new Error("没有找到要恢复的版本。");

  const versionId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const restoredStatus = restoredVersionStatus(target.scenes);
  const persistedScenes = target.scenes.map((scene) => ({
    ...scene,
    id: crypto.randomUUID(),
    assets: restorableSceneAssets(scene.assets)
      .map((asset) => ({ ...asset, id: crypto.randomUUID() }))
  }));
  const content = "已从历史版本创建新的当前版本，原有版本和修改记录均已保留。";
  const queries = [
    sql`
      select id
      from projects
      where id = ${params.projectId}
        and current_version_id = ${projectRow.current_version_id}
      for update
    `,
    sql`
      update edit_plans
      set status = 'rejected'
      where project_id = ${params.projectId}
        and base_version_id = ${projectRow.current_version_id}
        and status = 'proposed'
    `,
    sql`
      insert into project_versions (
        id,
        project_id,
        parent_version_id,
        status,
        scene_plan_json,
        duration_seconds
      )
      select
        ${versionId},
        ${params.projectId},
        ${projectRow.current_version_id},
        ${restoredStatus},
        ${JSON.stringify(persistedScenes)},
        ${target.durationSeconds}
      from projects
      where id = ${params.projectId}
        and current_version_id = ${projectRow.current_version_id}
    `,
    ...persistedScenes.flatMap((scene) => [
      sql`
        insert into scenes (
          id,
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
          ${scene.id},
          ${versionId},
          ${scene.sceneNumber},
          ${scene.title},
          ${scene.voiceover},
          ${scene.visualPrompt},
          ${scene.motionPrompt},
          ${scene.durationSeconds},
          ${JSON.stringify(scene.style)}
        )
      `,
      ...scene.assets.map((asset) => sql`
        insert into scene_assets (
          id,
          scene_id,
          asset_type,
          r2_key,
          public_url,
          metadata_json
        )
        values (
          ${asset.id},
          ${scene.id},
          ${asset.type},
          ${asset.r2Key},
          ${asset.url},
          ${JSON.stringify(asset.metadata ?? {})}
        )
      `)
    ]),
    sql`
      update projects
      set current_version_id = ${versionId}, updated_at = now()
      where id = ${params.projectId}
        and current_version_id = ${projectRow.current_version_id}
    `,
    sql`
      insert into chat_messages (id, project_id, version_id, role, message_type, content)
      values (${messageId}, ${params.projectId}, ${versionId}, 'assistant', 'version', ${content})
    `
  ];
  try {
    await sql.transaction(queries);
  } catch (error) {
    if (error instanceof Error && error.message.includes("foreign key")) {
      throw new Error("项目版本已经发生变化，请刷新后重试。");
    }
    throw error;
  }

  return {
    project: {
      id: params.projectId,
      title: projectRow.title,
      engine: "Animation Engine",
      credits: 0,
      plan: "Free",
      currentVersion: {
        ...target,
        id: versionId,
        parentVersionId: projectRow.current_version_id,
        label: "已恢复版本",
        status: restoredStatus,
        createdAt: new Date().toISOString(),
        renderUrl: undefined,
        renderJobId: undefined,
        scenes: persistedScenes
      }
    },
    message: { id: messageId, role: "assistant", type: "version", content, versionId }
  };
}
