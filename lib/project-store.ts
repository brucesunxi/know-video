import { getSql, hasDatabaseUrl } from "@/lib/db";
import { demoMessages, demoProject } from "@/lib/mock-data";
import { editPlanSchema } from "@/lib/edit-plan-schema";
import { mediaAssetStatus } from "@/lib/generation-resume";
import { assetUrlForKey } from "@/lib/r2";
import type { ChatMessage, EditPlan, Project, ProjectListItem, ProjectVersion, Scene, SceneAsset } from "@/lib/types";

type ProjectRow = {
  id: string;
  title: string;
  current_version_id: string | null;
};

type ProjectListRow = ProjectRow & {
  updated_at: Date | string;
  status: ProjectVersion["status"] | null;
  duration_seconds: number | null;
  scene_count: number;
  visual_count: number;
  audio_count: number;
  has_active_render: boolean;
  thumbnail_r2_key: string | null;
  thumbnail_public_url: string | null;
};

type VersionRow = {
  id: string;
  status: ProjectVersion["status"];
  scene_plan_json: unknown;
  render_url: string | null;
  active_render_job_id: string | null;
  duration_seconds: number;
  created_at: Date | string;
};

type SceneRow = {
  id: string;
  scene_number: number;
  title: string;
  voiceover: string;
  visual_prompt: string;
  motion_prompt: string;
  duration_seconds: number;
  style_json: unknown;
};

type MessageRow = {
  id: string;
  role: ChatMessage["role"];
  message_type: ChatMessage["type"];
  content: string;
  version_id: string | null;
  metadata_json: unknown;
};

type AssetRow = {
  id: string;
  scene_id: string;
  asset_type: SceneAsset["type"];
  r2_key: string;
  public_url: string | null;
  metadata_json: unknown;
};

type EditPlanRow = {
  id: string;
  base_version_id: string;
  patch_json: unknown;
  created_at: Date | string;
};

function cleanBrand(value: string) {
  return value
    .replaceAll("VYBEA", "Know Video")
    .replaceAll("vybea", "know video")
    .replaceAll("DeepSeek flash", "AI")
    .replaceAll("deepseek-flash", "AI")
    .replaceAll("DeepSeek", "AI")
    .replaceAll("deepseek", "AI");
}

function cleanBrandInJson<T>(value: T): T {
  try {
    return JSON.parse(cleanBrand(JSON.stringify(value))) as T;
  } catch {
    return value;
  }
}

function toScene(row: SceneRow, assets: SceneAsset[] = []): Scene {
  const style = row.style_json && typeof row.style_json === "object"
    ? row.style_json as Scene["style"]
    : { theme: "premium dark", palette: ["#07111d", "#38d5e5"], mood: "strategic" };

  return {
    id: row.id,
    sceneNumber: row.scene_number,
    title: cleanBrand(row.title),
    voiceover: cleanBrand(row.voiceover),
    visualPrompt: cleanBrand(row.visual_prompt),
    motionPrompt: cleanBrand(row.motion_prompt),
    durationSeconds: row.duration_seconds,
    style,
    assets
  };
}

function toAsset(row: AssetRow): SceneAsset {
  return {
    id: row.id,
    type: row.asset_type,
    r2Key: row.r2_key,
    url: assetUrlForKey(row.r2_key, row.public_url ?? undefined),
    metadata: row.metadata_json && typeof row.metadata_json === "object"
      ? row.metadata_json as Record<string, unknown>
      : {}
  };
}

function toMessage(row: MessageRow): ChatMessage {
  const metadata = row.metadata_json && typeof row.metadata_json === "object"
    ? row.metadata_json as Partial<ChatMessage>
    : {};

  return {
    id: row.id,
    role: row.role,
    type: row.message_type,
    content: cleanBrand(row.content),
    versionId: row.version_id ?? undefined,
    editPlan: metadata.editPlan ? cleanBrandInJson(metadata.editPlan) : undefined
  };
}

type ProjectSnapshot = {
  project: Project;
  messages: ChatMessage[];
  pendingPlan?: EditPlan;
  source: "database" | "empty" | "mock";
};

async function hydrateProjectSnapshot(projectRow: ProjectRow): Promise<ProjectSnapshot | undefined> {
  if (!projectRow.current_version_id) return undefined;

  const sql = getSql();
  const versions = await sql`
    select
      pv.id,
      pv.status,
      pv.scene_plan_json,
      pv.render_url,
      pv.duration_seconds,
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
    where pv.id = ${projectRow.current_version_id}
    limit 1
  ` as VersionRow[];

  const versionRow = versions[0];
  if (!versionRow) return undefined;

  const sceneRows = await sql`
    select id, scene_number, title, voiceover, visual_prompt, motion_prompt, duration_seconds, style_json
    from scenes
    where version_id = ${versionRow.id}
    order by scene_number asc
  ` as SceneRow[];

  const messageRows = await sql`
    select id, role, message_type, content, version_id, metadata_json
    from chat_messages
    where project_id = ${projectRow.id}
    order by created_at desc
    limit 50
  ` as MessageRow[];

  const pendingPlanRows = await sql`
    select id, base_version_id, patch_json, created_at
    from edit_plans
    where project_id = ${projectRow.id}
      and base_version_id = ${versionRow.id}
      and status = 'proposed'
    order by created_at desc
    limit 1
  ` as EditPlanRow[];

  const assetRows = sceneRows.length > 0 ? await sql`
    select id, scene_id, asset_type, r2_key, public_url, metadata_json
    from scene_assets
    where scene_id = any(${sceneRows.map((scene) => scene.id)})
    order by created_at asc
  ` as AssetRow[] : [];

  const assetMap = new Map<string, SceneAsset[]>();
  for (const asset of assetRows) {
    const current = assetMap.get(asset.scene_id) ?? [];
    current.push(toAsset(asset));
    assetMap.set(asset.scene_id, current);
  }

  const scenes = sceneRows.map((scene) => toScene(scene, assetMap.get(scene.id) ?? []));
  const visualCount = scenes.filter((scene) => scene.assets.some((asset) => ["image", "clip"].includes(asset.type))).length;
  const audioCount = scenes.filter((scene) => scene.assets.some((asset) => asset.type === "audio")).length;
  const mediaComplete = scenes.length > 0 && visualCount === scenes.length && audioCount === scenes.length;
  const assetStatus = mediaAssetStatus(scenes);
  const versionStatus = ["planning", "rendering", "failed"].includes(versionRow.status)
    ? versionRow.status
    : mediaComplete
      ? "ready"
      : "draft";
  const project: Project = {
    id: projectRow.id,
    title: cleanBrand(projectRow.title),
    engine: "Animation Engine",
    credits: demoProject.credits,
    plan: demoProject.plan,
    currentVersion: {
      id: versionRow.id,
      label: "current",
      status: versionStatus,
      createdAt: new Date(versionRow.created_at).toISOString(),
      durationSeconds: versionRow.duration_seconds,
      renderUrl: versionRow.render_url ?? undefined,
      renderJobId: versionRow.active_render_job_id ?? undefined,
      assetStatus,
      scenes: scenes.length > 0 ? scenes : demoProject.currentVersion.scenes
    }
  };
  const pendingPlanRow = pendingPlanRows[0];
  const parsedPendingPlan = pendingPlanRow
    ? editPlanSchema.safeParse(cleanBrandInJson(pendingPlanRow.patch_json))
    : undefined;
  const pendingPlan = pendingPlanRow && parsedPendingPlan?.success
    ? {
      ...parsedPendingPlan.data,
      id: pendingPlanRow.id,
      baseVersionId: pendingPlanRow.base_version_id,
      status: "proposed" as const,
      createdAt: new Date(pendingPlanRow.created_at).toISOString()
    }
    : undefined;

  return {
    project,
    messages: messageRows.length > 0 ? messageRows.reverse().map(toMessage) : demoMessages,
    pendingPlan,
    source: "database"
  };
}

export async function listProjects(): Promise<ProjectListItem[]> {
  if (!hasDatabaseUrl()) {
    const firstImage = demoProject.currentVersion.scenes
      .flatMap((scene) => scene.assets)
      .find((asset) => asset.type === "image");
    return [{
      id: demoProject.id,
      title: demoProject.title,
      updatedAt: demoProject.currentVersion.createdAt,
      status: demoProject.currentVersion.status,
      durationSeconds: demoProject.currentVersion.durationSeconds,
      sceneCount: demoProject.currentVersion.scenes.length,
      visualCount: demoProject.currentVersion.scenes.filter((scene) => scene.assets.some((asset) => ["image", "clip"].includes(asset.type))).length,
      audioCount: demoProject.currentVersion.scenes.filter((scene) => scene.assets.some((asset) => asset.type === "audio")).length,
      thumbnailUrl: firstImage?.url
    }];
  }

  const sql = getSql();
  const rows = await sql`
    select
      p.id,
      p.title,
      p.current_version_id,
      p.updated_at,
      pv.status,
      pv.duration_seconds,
      count(distinct s.id)::int as scene_count,
      count(distinct s.id) filter (
        where exists (
          select 1
          from scene_assets visual_asset
          where visual_asset.scene_id = s.id
            and visual_asset.asset_type in ('image', 'clip')
        )
      )::int as visual_count,
      count(distinct s.id) filter (
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
        where active_render.project_id = p.id
          and active_render.version_id = p.current_version_id
          and active_render.status in ('queued', 'running')
      ) as has_active_render,
      (
        select sa.r2_key
        from scenes first_scene
        join scene_assets sa on sa.scene_id = first_scene.id and sa.asset_type in ('image', 'clip')
        where first_scene.version_id = p.current_version_id
        order by first_scene.scene_number asc, sa.created_at desc
        limit 1
      ) as thumbnail_r2_key,
      (
        select sa.public_url
        from scenes first_scene
        join scene_assets sa on sa.scene_id = first_scene.id and sa.asset_type in ('image', 'clip')
        where first_scene.version_id = p.current_version_id
        order by first_scene.scene_number asc, sa.created_at desc
        limit 1
      ) as thumbnail_public_url
    from projects p
    left join project_versions pv on pv.id = p.current_version_id
    left join scenes s on s.version_id = p.current_version_id
    group by p.id, pv.id
    order by p.updated_at desc
    limit 100
  ` as ProjectListRow[];

  return rows.map((row) => {
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
      title: cleanBrand(row.title),
      updatedAt: new Date(row.updated_at).toISOString(),
      status,
      durationSeconds: row.duration_seconds ?? 0,
      sceneCount: row.scene_count,
      visualCount: row.visual_count,
      audioCount: row.audio_count,
      thumbnailUrl: row.thumbnail_r2_key
        ? assetUrlForKey(row.thumbnail_r2_key, row.thumbnail_public_url ?? undefined)
        : undefined
    };
  });
}

export async function getProjectSnapshot(projectId: string): Promise<ProjectSnapshot | undefined> {
  if (!hasDatabaseUrl()) {
    return projectId === demoProject.id
      ? { project: demoProject, messages: demoMessages, source: "mock" }
      : undefined;
  }

  const sql = getSql();
  const projects = await sql`
    select id, title, current_version_id
    from projects
    where id = ${projectId}
    limit 1
  ` as ProjectRow[];
  if (!projects[0]) return undefined;
  return hydrateProjectSnapshot(projects[0]);
}

export async function getCurrentProjectSnapshot(): Promise<ProjectSnapshot> {
  if (!hasDatabaseUrl()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("生产环境数据库尚未配置。");
    }
    return { project: demoProject, messages: demoMessages, source: "mock" };
  }

  try {
    const sql = getSql();
    const projects = await sql`
      select id, title, current_version_id
      from projects
      order by updated_at desc
      limit 1
    ` as ProjectRow[];

    const projectRow = projects[0];
    if (!projectRow?.current_version_id) {
      return { project: demoProject, messages: [], source: "empty" };
    }

    return await hydrateProjectSnapshot(projectRow)
      ?? { project: demoProject, messages: [], source: "empty" };
  } catch (error) {
    console.error("[project-store] Unable to load the current project:", error);
    if (process.env.NODE_ENV === "production") throw error;
    return { project: demoProject, messages: demoMessages, source: "mock" };
  }
}
