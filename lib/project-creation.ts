import type { Project, ProjectVersion, Scene } from "@/lib/types";

export function initialVersionStatus(project: Project): ProjectVersion["status"] {
  const scenes = project.currentVersion.scenes;
  if (scenes.length === 0) return "failed";
  const hasAllVisuals = scenes.every((scene) => scene.assets.some((asset) => asset.type === "image" || asset.type === "clip"));
  const hasAllAudio = scenes.every((scene) => scene.assets.some((asset) => asset.type === "audio"));
  return hasAllVisuals && hasAllAudio ? "ready" : "draft";
}

export function materializeNewProject(
  project: Project,
  createId: () => string = crypto.randomUUID
): {
  projectId: string;
  versionId: string;
  userMessageId: string;
  assistantMessageId: string;
  scenes: Scene[];
} {
  return {
    projectId: createId(),
    versionId: createId(),
    userMessageId: createId(),
    assistantMessageId: createId(),
    scenes: project.currentVersion.scenes.map((scene) => ({
      ...scene,
      id: createId(),
      assets: scene.assets
        .filter((asset) => asset.type !== "render")
        .map((asset) => ({ ...asset, id: createId() }))
    }))
  };
}
