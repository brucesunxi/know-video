import type { ProjectVersion, Scene, SceneAsset } from "@/lib/types";

export function restoredVersionStatus(scenes: Scene[]): ProjectVersion["status"] {
  if (scenes.length === 0) return "draft";
  const complete = scenes.every((scene) => (
    scene.assets.some((asset) => asset.type === "image" || asset.type === "clip")
    && scene.assets.some((asset) => asset.type === "audio")
  ));
  return complete ? "ready" : "draft";
}

export function restorableSceneAssets(assets: SceneAsset[]) {
  return assets.filter((asset) => asset.type !== "render");
}

export function assertRestorableVersion(input: {
  projectId: string;
  targetProjectId: string;
  currentVersionId: string;
  targetVersionId: string;
}) {
  if (input.projectId !== input.targetProjectId) {
    throw new Error("该历史版本不属于当前项目。");
  }
  if (input.currentVersionId === input.targetVersionId) {
    throw new Error("当前版本不需要重复恢复。");
  }
}
