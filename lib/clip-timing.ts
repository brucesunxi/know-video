import type { SceneAsset } from "@/lib/types";

function clipDurationSeconds(asset: SceneAsset) {
  const duration = Number(asset.metadata?.duration ?? asset.metadata?.actualDurationSeconds);
  return Number.isFinite(duration) && duration > 0 ? duration : undefined;
}

export function resolvedClipPlaybackRate(input: {
  asset: SceneAsset;
  sceneDurationSeconds: number;
  productionPlaybackRate: number;
}) {
  const productionRate = Math.max(0.1, input.productionPlaybackRate);
  const duration = clipDurationSeconds(input.asset);
  if (!duration || input.sceneDurationSeconds <= 0) return productionRate;

  const durationRatio = duration / input.sceneDurationSeconds;
  const generated = input.asset.metadata?.source === "generated-video";
  const canFitUploadedClip = durationRatio >= 0.25 && durationRatio <= 2;
  if (!generated && !canFitUploadedClip) return productionRate;

  return Math.max(0.1, Math.min(2, productionRate * durationRatio));
}

export function clipDurationInFrames(asset: SceneAsset, fps: number, playbackRate: number) {
  const duration = clipDurationSeconds(asset);
  if (!duration) return undefined;
  return Math.max(1, Math.round((duration * fps) / Math.max(0.1, playbackRate)));
}
