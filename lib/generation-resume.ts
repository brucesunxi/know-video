import type { Scene } from "@/lib/types";

export function missingSceneAssetNumbers(scenes: Scene[], type: "image" | "audio") {
  return scenes
    .filter((scene) => !scene.assets.some((asset) => asset.type === type && Boolean(asset.url)))
    .map((scene) => scene.sceneNumber);
}

export function missingMotionSceneNumbers(scenes: Scene[], selectedSceneNumbers: number[]) {
  const selected = new Set(selectedSceneNumbers);
  return scenes
    .filter((scene) => selected.has(scene.sceneNumber))
    .filter((scene) => !scene.assets.some((asset) => asset.type === "clip" && Boolean(asset.url)))
    .map((scene) => scene.sceneNumber);
}
