export const billingResourceTypes = [
  "storyboard_plan",
  "edit_plan",
  "vision_analysis",
  "image_standard",
  "image_premium",
  "speech",
  "video_economy_3s",
  "video_balanced_3s",
  "render_mp4"
] as const;

export type BillingResourceType = (typeof billingResourceTypes)[number];

export type BillingCatalogItem = {
  resourceType: BillingResourceType;
  label: string;
  provider: string;
  model: string;
  billingUnit: "request" | "image" | "audio_second" | "clip" | "render";
  creditsPerUnit: number;
  minimumCredits?: number;
  estimatedProviderUsdPerUnit: number;
  bundled?: boolean;
};

export type BillingEstimateItemInput = {
  resourceType: BillingResourceType;
  quantity: number;
};

export type BillingEstimateLine = BillingEstimateItemInput & {
  label: string;
  provider: string;
  model: string;
  billingUnit: BillingCatalogItem["billingUnit"];
  credits: number;
  estimatedProviderCostUsd: number;
  projectedMarginRate: number | null;
};

export type BillingEstimate = {
  maximumCredits: number;
  estimatedProviderCostUsd: number;
  projectedMarginRate: number | null;
  currency: "CNY";
  pointsPerCny: number;
  lines: BillingEstimateLine[];
};
