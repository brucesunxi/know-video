export const VIDEO_GENERATION_MODEL = "xai/grok-imagine-video" as const;
export const VIDEO_GENERATION_DURATION_SECONDS = 3 as const;
export const VIDEO_GENERATION_CLOUDFLARE_FEE_RATE = 0.05;

export type VideoGenerationTier = "economy" | "balanced";

export const VIDEO_GENERATION_TIERS = {
  economy: {
    label: "经济动态",
    resolution: "480p",
    outputUsdPerSecond: 0.05,
    imageInputUsd: 0.002
  },
  balanced: {
    label: "均衡动态",
    resolution: "720p",
    outputUsdPerSecond: 0.07,
    imageInputUsd: 0.002
  }
} as const;

export function videoGenerationEstimate(tier: VideoGenerationTier) {
  const profile = VIDEO_GENERATION_TIERS[tier];
  const providerUsd = profile.outputUsdPerSecond * VIDEO_GENERATION_DURATION_SECONDS + profile.imageInputUsd;
  const estimatedUsd = providerUsd * (1 + VIDEO_GENERATION_CLOUDFLARE_FEE_RATE);
  return {
    model: VIDEO_GENERATION_MODEL,
    durationSeconds: VIDEO_GENERATION_DURATION_SECONDS,
    resolution: profile.resolution,
    estimatedUsd: Math.ceil(estimatedUsd * 100) / 100
  };
}

export function videoGenerationEstimateLabel(tier: VideoGenerationTier) {
  return `$${videoGenerationEstimate(tier).estimatedUsd.toFixed(2)}`;
}

export function isVideoGenerationTier(value: unknown): value is VideoGenerationTier {
  return value === "economy" || value === "balanced";
}
