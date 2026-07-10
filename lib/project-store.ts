import { getSql, hasDatabaseUrl } from "@/lib/db";
import { demoMessages, demoProject } from "@/lib/mock-data";
import type { ChatMessage, Project, ProjectVersion, Scene } from "@/lib/types";

type ProjectRow = {
  id: string;
  title: string;
  current_version_id: string | null;
};

type VersionRow = {
  id: string;
  status: ProjectVersion["status"];
  scene_plan_json: unknown;
  render_url: string | null;
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

function toScene(row: SceneRow): Scene {
  const style = row.style_json && typeof row.style_json === "object"
    ? row.style_json as Scene["style"]
    : { theme: "premium dark", palette: ["#07111d", "#38d5e5"], mood: "strategic" };

  return {
    id: row.id,
    sceneNumber: row.scene_number,
    title: row.title,
    voiceover: row.voiceover,
    visualPrompt: row.visual_prompt,
    motionPrompt: row.motion_prompt,
    durationSeconds: row.duration_seconds,
    style,
    assets: []
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
    content: row.content,
    versionId: row.version_id ?? undefined,
    editPlan: metadata.editPlan
  };
}

export async function getCurrentProjectSnapshot(): Promise<{
  project: Project;
  messages: ChatMessage[];
  source: "database" | "mock";
}> {
  if (!hasDatabaseUrl()) {
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
      return { project: demoProject, messages: demoMessages, source: "mock" };
    }

    const versions = await sql`
      select id, status, scene_plan_json, render_url, duration_seconds, created_at
      from project_versions
      where id = ${projectRow.current_version_id}
      limit 1
    ` as VersionRow[];

    const versionRow = versions[0];
    if (!versionRow) {
      return { project: demoProject, messages: demoMessages, source: "mock" };
    }

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
      order by created_at asc
      limit 50
    ` as MessageRow[];

    const scenes = sceneRows.map(toScene);
    const project: Project = {
      id: projectRow.id,
      title: projectRow.title,
      engine: "Animation Engine",
      credits: demoProject.credits,
      plan: demoProject.plan,
      currentVersion: {
        id: versionRow.id,
        label: "current",
        status: versionRow.status,
        createdAt: new Date(versionRow.created_at).toISOString(),
        durationSeconds: versionRow.duration_seconds,
        renderUrl: versionRow.render_url ?? undefined,
        scenes: scenes.length > 0 ? scenes : demoProject.currentVersion.scenes
      }
    };

    return {
      project,
      messages: messageRows.length > 0 ? messageRows.map(toMessage) : demoMessages,
      source: "database"
    };
  } catch (error) {
    console.error("[project-store] Falling back to mock data:", error);
    return { project: demoProject, messages: demoMessages, source: "mock" };
  }
}
