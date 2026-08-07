import { videoGenerationEstimate } from "@/lib/video-cost-policy";
import type { BillingCatalogItem, BillingResourceType } from "@/lib/billing/types";

export const POINTS_PER_CNY = 100;
export const BILLING_EXCHANGE_RATE_CNY_PER_USD = 7.2;
export const BILLING_TAX_RATE = 0.06;
export const BILLING_PAYMENT_FEE_RATE = 0.03;
export const BILLING_RETRY_RESERVE_RATE = 0.10;
export const BILLING_TARGET_MARGIN_RATE = 0.50;
export const BILLING_MINIMUM_MARGIN_RATE = 0.40;
export const BILLING_RELEASE = "2026-08-07.v1";

const economyVideo = videoGenerationEstimate("economy");
const balancedVideo = videoGenerationEstimate("balanced");

export const billingCatalog: Record<BillingResourceType, BillingCatalogItem> = {
  storyboard_plan: {
    resourceType: "storyboard_plan",
    label: "脚本与分镜",
    provider: "configured-text-planner",
    model: "configured-text-planner",
    billingUnit: "request",
    creditsPerUnit: 20,
    estimatedProviderUsdPerUnit: 0.005
  },
  edit_plan: {
    resourceType: "edit_plan",
    label: "修改方案",
    provider: "configured-text-planner",
    model: "configured-text-planner",
    billingUnit: "request",
    creditsPerUnit: 5,
    estimatedProviderUsdPerUnit: 0.002
  },
  vision_analysis: {
    resourceType: "vision_analysis",
    label: "参考素材分析",
    provider: "cloudflare",
    model: "@cf/moondream/moondream3.1-9B-A2B",
    billingUnit: "request",
    creditsPerUnit: 5,
    estimatedProviderUsdPerUnit: 0.0005
  },
  image_standard: {
    resourceType: "image_standard",
    label: "标准场景画面",
    provider: "cloudflare",
    model: "@cf/black-forest-labs/flux-2-klein-4b",
    billingUnit: "image",
    creditsPerUnit: 20,
    estimatedProviderUsdPerUnit: 0.0032
  },
  image_premium: {
    resourceType: "image_premium",
    label: "高清场景画面",
    provider: "cloudflare",
    model: "@cf/black-forest-labs/flux-2-klein-9b",
    billingUnit: "image",
    creditsPerUnit: 80,
    estimatedProviderUsdPerUnit: 0.0225
  },
  speech: {
    resourceType: "speech",
    label: "旁白配音",
    provider: "speech-router",
    model: "configured-tts",
    billingUnit: "audio_second",
    creditsPerUnit: 1,
    minimumCredits: 5,
    estimatedProviderUsdPerUnit: 0.00025
  },
  video_economy_3s: {
    resourceType: "video_economy_3s",
    label: "经济动态镜头",
    provider: "cloudflare",
    model: economyVideo.model,
    billingUnit: "clip",
    creditsPerUnit: 300,
    estimatedProviderUsdPerUnit: economyVideo.estimatedUsd
  },
  video_balanced_3s: {
    resourceType: "video_balanced_3s",
    label: "均衡动态镜头",
    provider: "cloudflare",
    model: balancedVideo.model,
    billingUnit: "clip",
    creditsPerUnit: 430,
    estimatedProviderUsdPerUnit: balancedVideo.estimatedUsd
  },
  render_mp4: {
    resourceType: "render_mp4",
    label: "MP4 合成",
    provider: "vercel-sandbox",
    model: "remotion",
    billingUnit: "render",
    creditsPerUnit: 0,
    estimatedProviderUsdPerUnit: 0.03,
    bundled: true
  }
};

export function billingCatalogItem(resourceType: BillingResourceType) {
  return billingCatalog[resourceType];
}
