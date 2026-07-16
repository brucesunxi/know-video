import { getSql, hasDatabaseUrl } from "@/lib/db";
import { demoProject } from "@/lib/mock-data";
import { generateProjectSceneImages } from "@/lib/image-assets";
import { generateProjectVoices } from "@/lib/audio-assets";
import { assetUrlForKey } from "@/lib/r2";
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
    select id, parent_version_id, status, duration_seconds, render_url, created_at
    from project_versions
    where id = ${versionId}
    limit 1
  ` as Array<{
    id: string;
    parent_version_id: string | null;
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
  const visualCount = hydratedScenes.filter((scene) => scene.assets.some((asset) => ["image", "clip"].includes(asset.type))).length;

  return {
    id: version.id,
    parentVersionId: version.parent_version_id ?? undefined,
    label: "current",
    status: version.status,
    createdAt: new Date(version.created_at).toISOString(),
    durationSeconds: version.duration_seconds,
    renderUrl: version.render_url ?? undefined,
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

  for (const scene of scenes) {
    if (selected && !selected.has(scene.sceneNumber)) continue;
    const sceneId = sceneIdByNumber.get(scene.sceneNumber);
    if (!sceneId) continue;

    if (options.replaceAudio) {
      await sql`
        delete from scene_assets
        where scene_id = ${sceneId} and asset_type = 'audio'
      `;
    }
    if (options.replaceImages) {
      await sql`
        delete from scene_assets
        where scene_id = ${sceneId} and asset_type in ('image', 'clip')
      `;
    }

    for (const asset of scene.assets) {
      await sql`
        insert into scene_assets (scene_id, asset_type, r2_key, public_url, metadata_json)
        select ${sceneId}, ${asset.type}, ${asset.r2Key}, ${asset.url}, ${JSON.stringify(asset.metadata ?? {})}
        where not exists (
          select 1 from scene_assets where scene_id = ${sceneId} and r2_key = ${asset.r2Key}
        )
      `;
    }
  }

  const counts = await sql`
    select
      count(*)::int as scene_count,
      count(*) filter (
        where exists (
          select 1 from scene_assets sa where sa.scene_id = scenes.id and sa.asset_type in ('image', 'clip')
        )
      )::int as visual_count
    from scenes
    where version_id = ${versionId}
  ` as Array<{ scene_count: number; visual_count: number }>;
  const complete = (counts[0]?.scene_count ?? 0) > 0
    && counts[0]?.scene_count === counts[0]?.visual_count;
  await sql`
    update project_versions
    set status = ${complete ? "ready" : "draft"}
    where id = ${versionId}
  `;
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
  await sql`
    update edit_plans set status = 'rejected'
    where id = ${params.editPlanId} and project_id = ${params.projectId} and status = 'proposed'
  `;
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
  const changedProject = applyEditPlan(params.project, params.editPlan);
  const imageSceneNumbers = params.editPlan.changes
    .filter((change) => change.regenerate.some((type) => ["image", "thumbnail", "clip"].includes(type)))
    .map((change) => change.sceneNumber);
  const audioSceneNumbers = params.editPlan.changes
    .filter((change) => change.regenerate.includes("audio") || change.after.voiceover !== change.before.voiceover)
    .map((change) => change.sceneNumber);
  const projectWithImages = imageSceneNumbers.length > 0
    ? await generateProjectSceneImages(changedProject, {
      replaceExistingImages: true,
      sceneNumbers: imageSceneNumbers
    })
    : changedProject;
  if (imageSceneNumbers.length > 0 && projectWithImages.currentVersion.assetErrorCode) {
    throw new Error("部分场景画面生成失败，修改尚未应用。请稍后重试。");
  }
  const nextProject = audioSceneNumbers.length > 0
    ? await generateProjectVoices(projectWithImages, audioSceneNumbers)
    : projectWithImages;
  if (audioSceneNumbers.some((sceneNumber) => {
    const scene = nextProject.currentVersion.scenes.find((item) => item.sceneNumber === sceneNumber);
    return !scene?.assets.some((asset) => asset.type === "audio" && asset.url);
  })) {
    throw new Error("部分场景配音生成失败，修改尚未应用。请检查语音服务后重试。");
  }

  if (!canPersist()) {
    return {
      project: nextProject,
      message: {
        id: crypto.randomUUID(),
        role: "assistant",
        type: "version",
        content: "修改已经应用，并创建了一个可随时恢复的新版本。",
        versionId: nextProject.currentVersion.id
      },
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

  const content = "修改已经应用，并创建了一个可随时恢复的新版本。确认预览后即可导出 MP4。";
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
    }
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
      count(s.id)::int as scene_count
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
  }>;
  return rows.map((row, index) => ({
    id: row.id,
    parentVersionId: row.parent_version_id ?? undefined,
    label: `版本 ${rows.length - index}`,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    durationSeconds: row.duration_seconds,
    renderUrl: row.render_url ?? undefined,
    sceneCount: row.scene_count,
    isCurrent: row.id === row.current_version_id
  }));
}

export async function restoreProjectVersion(params: {
  projectId: string;
  targetVersionId: string;
}): Promise<{ project: Project; message: ChatMessage }> {
  if (!canPersist()) throw new Error("版本恢复需要数据库连接。");
  const target = await loadVersion(params.targetVersionId);
  if (!target) throw new Error("没有找到要恢复的版本。");
  const sql = getSql();
  const projects = await sql`
    select title, current_version_id from projects where id = ${params.projectId} limit 1
  ` as Array<{ title: string; current_version_id: string | null }>;
  if (!projects[0] || !projects[0].current_version_id) throw new Error("没有找到项目。");

  const rows = await sql`
    insert into project_versions (project_id, parent_version_id, status, scene_plan_json, duration_seconds)
    values (
      ${params.projectId},
      ${projects[0].current_version_id},
      ${target.status === "failed" ? "draft" : target.status},
      ${JSON.stringify(target.scenes)},
      ${target.durationSeconds}
    )
    returning id
  ` as IdRow[];
  const versionId = rows[0].id;
  await insertScenes(versionId, target.scenes);
  await sql`update projects set current_version_id = ${versionId}, updated_at = now() where id = ${params.projectId}`;
  const content = "已从历史版本创建新的当前版本，原有版本和修改记录均已保留。";
  const messageRows = await sql`
    insert into chat_messages (project_id, version_id, role, message_type, content)
    values (${params.projectId}, ${versionId}, 'assistant', 'version', ${content})
    returning id
  ` as IdRow[];
  return {
    project: {
      id: params.projectId,
      title: projects[0].title,
      engine: "Animation Engine",
      credits: 0,
      plan: "Free",
      currentVersion: { ...target, id: versionId, parentVersionId: projects[0].current_version_id, label: "已恢复版本", renderUrl: undefined }
    },
    message: { id: messageRows[0].id, role: "assistant", type: "version", content, versionId }
  };
}
