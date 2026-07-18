import type { ChatMessage, EditPlan, Project, ProjectListItem, Scene } from "@/lib/types";

type EphemeralProjectRecord = {
  project: Project;
  messages: ChatMessage[];
  pendingPlan?: EditPlan;
  updatedAt: string;
};

const globalStore = globalThis as typeof globalThis & {
  __knowVideoEphemeralProjects?: Map<string, EphemeralProjectRecord>;
};

const projects: Map<string, EphemeralProjectRecord> = globalStore.__knowVideoEphemeralProjects ??= new Map<string, EphemeralProjectRecord>();

export function saveEphemeralProject(
  project: Project,
  options: { messages?: ChatMessage[]; pendingPlan?: EditPlan | null } = {}
) {
  const current = projects.get(project.id);
  const record: EphemeralProjectRecord = {
    project,
    messages: options.messages ?? current?.messages ?? [],
    pendingPlan: options.pendingPlan === null ? undefined : options.pendingPlan ?? current?.pendingPlan,
    updatedAt: new Date().toISOString()
  };
  projects.set(project.id, record);
  return record;
}

export function getEphemeralProject(projectId: string, versionId?: string) {
  const record = projects.get(projectId);
  if (!record || (versionId && record.project.currentVersion.id !== versionId)) return undefined;
  return record;
}

export function updateEphemeralVersionScenes(versionId: string, scenes: Scene[]) {
  for (const record of projects.values()) {
    if (record.project.currentVersion.id !== versionId) continue;
    const visualCount = scenes.filter((scene) => scene.assets.some((asset) => ["image", "clip"].includes(asset.type))).length;
    const audioCount = scenes.filter((scene) => scene.assets.some((asset) => asset.type === "audio")).length;
    const project: Project = {
      ...record.project,
      currentVersion: {
        ...record.project.currentVersion,
        status: visualCount === scenes.length && audioCount === scenes.length ? "ready" : "draft",
        assetStatus: visualCount === scenes.length ? "ready" : visualCount > 0 ? "partial" : "failed",
        renderUrl: undefined,
        scenes
      }
    };
    return saveEphemeralProject(project);
  }
  return undefined;
}

export function appendEphemeralMessages(projectId: string, messages: ChatMessage[]) {
  const current = projects.get(projectId);
  if (!current) return;
  saveEphemeralProject(current.project, { messages: [...current.messages, ...messages] });
}

export function listEphemeralProjects(): ProjectListItem[] {
  return Array.from(projects.values())
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map(({ project, updatedAt }) => {
      const scenes = project.currentVersion.scenes;
      const firstVisual = scenes.flatMap((scene) => scene.assets).find((asset) => ["image", "clip"].includes(asset.type));
      return {
        id: project.id,
        title: project.title,
        updatedAt,
        status: project.currentVersion.status,
        durationSeconds: project.currentVersion.durationSeconds,
        sceneCount: scenes.length,
        visualCount: scenes.filter((scene) => scene.assets.some((asset) => ["image", "clip"].includes(asset.type))).length,
        audioCount: scenes.filter((scene) => scene.assets.some((asset) => asset.type === "audio")).length,
        renderUrl: project.currentVersion.renderUrl,
        thumbnailUrl: firstVisual?.url
      };
    });
}
