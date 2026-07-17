import type { Scene } from "@/lib/types";

export function sceneHasVisualAsset(scene: Scene) {
  return scene.assets.some((asset) => ["image", "clip"].includes(asset.type) && Boolean(asset.url));
}

export function sceneHasAudioAsset(scene: Scene) {
  return scene.assets.some((asset) => asset.type === "audio" && Boolean(asset.url));
}

export function missingSceneAssetNumbers(scenes: Scene[], type: "image" | "audio") {
  return scenes
    .filter((scene) => type === "image" ? !sceneHasVisualAsset(scene) : !sceneHasAudioAsset(scene))
    .map((scene) => scene.sceneNumber);
}

export function missingMotionSceneNumbers(scenes: Scene[], selectedSceneNumbers: number[]) {
  const selected = new Set(selectedSceneNumbers);
  return scenes
    .filter((scene) => selected.has(scene.sceneNumber))
    .filter((scene) => !scene.assets.some((asset) => asset.type === "clip" && Boolean(asset.url)))
    .map((scene) => scene.sceneNumber);
}

export function mediaAssetStatus(scenes: Scene[]) {
  if (scenes.length === 0) return "failed" as const;
  const visualCount = scenes.filter(sceneHasVisualAsset).length;
  const audioCount = scenes.filter(sceneHasAudioAsset).length;
  if (visualCount === scenes.length && audioCount === scenes.length) return "ready" as const;
  if (visualCount > 0 || audioCount > 0) return "partial" as const;
  return "failed" as const;
}
