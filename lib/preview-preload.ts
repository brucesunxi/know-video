import type { Project, SceneAsset } from "@/lib/types";

export type PreviewPreloadAsset = Pick<SceneAsset, "type" | "url"> & {
  estimatedBytes: number;
};

export const PREVIEW_PRELOAD_BUDGET_BYTES = 96 * 1024 * 1024;
export const PREVIEW_PRELOAD_MAX_ASSETS = 18;

const FALLBACK_BYTES: Partial<Record<SceneAsset["type"], number>> = {
  clip: 12 * 1024 * 1024,
  image: 4 * 1024 * 1024,
  audio: 2 * 1024 * 1024,
  music: 5 * 1024 * 1024,
  logo: 1 * 1024 * 1024
};

function assetBytes(asset: SceneAsset) {
  const size = Number(asset.metadata?.size);
  return Number.isFinite(size) && size > 0
    ? size
    : FALLBACK_BYTES[asset.type] ?? 4 * 1024 * 1024;
}

function primarySceneAssets(assets: SceneAsset[]) {
  const clip = assets.find((asset) => asset.type === "clip" && asset.url);
  const image = assets.find((asset) => asset.type === "image" && asset.url);
  const audio = assets.find((asset) => asset.type === "audio" && asset.url);
  return [clip ?? image, audio].filter((asset): asset is SceneAsset => Boolean(asset));
}

export function previewPreloadAssets(project: Project): PreviewPreloadAsset[] {
  const sceneAssets = project.currentVersion.scenes.flatMap((scene) => primarySceneAssets(scene.assets));
  const productionAssets = project.currentVersion.scenes
    .flatMap((scene) => scene.assets)
    .filter((asset) => (asset.type === "music" || asset.type === "logo") && asset.url);
  const unique = new Map<string, SceneAsset>();

  for (const asset of [...sceneAssets, ...productionAssets]) {
    if (!unique.has(asset.url)) unique.set(asset.url, asset);
  }

  const selected: PreviewPreloadAsset[] = [];
  let totalBytes = 0;
  for (const asset of unique.values()) {
    const estimatedBytes = assetBytes(asset);
    if (selected.length >= PREVIEW_PRELOAD_MAX_ASSETS) break;
    if (selected.length > 0 && totalBytes + estimatedBytes > PREVIEW_PRELOAD_BUDGET_BYTES) break;
    selected.push({ type: asset.type, url: asset.url, estimatedBytes });
    totalBytes += estimatedBytes;
  }
  return selected;
}
