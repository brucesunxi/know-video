import type { Scene, SceneAsset } from "@/lib/types";

export function isDeliverableVisualAsset(asset: SceneAsset) {
  if (!["image", "clip"].includes(asset.type) || !asset.url) return false;
  const source = String(asset.metadata?.source ?? "").toLowerCase();
  const model = String(asset.metadata?.model ?? "").toLowerCase();
  const completionFallbackReason = String(asset.metadata?.completionFallbackReason ?? "").toLowerCase();
  const legacyQualityFallback = asset.metadata?.qualityFallback === true;
  const unsafeCompletionFallback = ["technical_only", "text_detected", "combined_text_disagreement"].includes(completionFallbackReason);
  return source !== "fallback-image"
    && model !== "local-svg-fallback"
    && !legacyQualityFallback
    && !unsafeCompletionFallback;
}

export function sceneHasVisualAsset(scene: Scene) {
  return scene.assets.some(isDeliverableVisualAsset);
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
