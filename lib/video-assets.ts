import { generateCloudflareVideo, hasCloudflareAI } from "@/lib/cloudflare-ai";
import { assetUrlForKey, uploadToR2 } from "@/lib/r2";
import type { Project, Scene, SceneAsset, VideoGenerationTier } from "@/lib/types";
import { VIDEO_GENERATION_DURATION_SECONDS, VIDEO_GENERATION_TIERS, videoGenerationEstimate } from "@/lib/video-cost-policy";
import { inspectGeneratedVideo } from "@/lib/video-quality";

function sceneVideoPrompt(scene: Scene, project: Project) {
  return [
    `Animate the supplied keyframe as a premium cinematic shot for "${project.title}".`,
    `Scene purpose: ${scene.title}.`,
    `Motion direction: ${scene.motionPrompt}.`,
    "Preserve the exact subjects, composition, palette, lighting, and visual identity of the reference image.",
    "Use physically plausible subject motion, subtle environmental movement, stable geometry, and smooth professional camera movement.",
    "No cuts, no new text, no logos, no morphing, no duplicated objects, no flicker, no camera shake, and no audio."
  ].join("\n");
}

function absoluteAssetUrl(url: string, assetBaseUrl: string) {
  return new URL(url, assetBaseUrl.endsWith("/") ? assetBaseUrl : `${assetBaseUrl}/`).toString();
}

async function generateSceneClip(input: {
  scene: Scene;
  project: Project;
  assetBaseUrl: string;
  tier: VideoGenerationTier;
}) {
  const image = input.scene.assets.find((asset) => asset.type === "image" && asset.url);
  if (!image) throw new Error("Scene has no reference image for video generation");
  const prompt = sceneVideoPrompt(input.scene, input.project);
  const duration = VIDEO_GENERATION_DURATION_SECONDS;
  const costEstimate = videoGenerationEstimate(input.tier);
  const generated = await generateCloudflareVideo({
    imageUrl: absoluteAssetUrl(image.url, input.assetBaseUrl),
    prompt,
    tier: input.tier
  });
  const videoMetadata = await inspectGeneratedVideo(generated.body, duration);
  const key = `generated/${input.project.id}/${input.project.currentVersion.id}/scene-${input.scene.sceneNumber}-${crypto.randomUUID()}.mp4`;
  const uploaded = await uploadToR2({ key, body: generated.body, contentType: "video/mp4" });
  return {
    id: crypto.randomUUID(),
    type: "clip",
    r2Key: uploaded.key,
    url: assetUrlForKey(uploaded.key, uploaded.publicUrl),
    metadata: {
      source: "generated-video",
      model: generated.model,
      tier: input.tier,
      resolution: VIDEO_GENERATION_TIERS[input.tier].resolution,
      estimatedCostUsd: costEstimate.estimatedUsd,
      billingEstimate: "provider-price-plus-cloudflare-5-percent",
      ...videoMetadata,
      prompt,
      referenceKey: image.r2Key,
      sceneNumber: input.scene.sceneNumber
    }
  } satisfies SceneAsset;
}

export async function generateProjectSceneClips(
  project: Project,
  input: {
    assetBaseUrl: string;
    sceneNumbers: number[];
    tier: VideoGenerationTier;
  }
) {
  if (!hasCloudflareAI()) throw new Error("Cloudflare AI video service is not configured");
  const targets = new Set(input.sceneNumbers);
  const scenes = [...project.currentVersion.scenes];
  const failures: Array<{ sceneNumber: number; error: unknown }> = [];

  for (const [index, scene] of scenes.entries()) {
    if (!targets.has(scene.sceneNumber)) continue;
    try {
      const clip = await generateSceneClip({
        scene,
        project,
        assetBaseUrl: input.assetBaseUrl,
        tier: input.tier
      });
      scenes[index] = {
        ...scene,
        assets: [clip, ...scene.assets.filter((asset) => asset.type !== "clip")]
      };
    } catch (error) {
      failures.push({ sceneNumber: scene.sceneNumber, error });
      console.error(`[video-assets] Scene ${scene.sceneNumber} clip generation failed:`, error);
    }
  }

  return {
    project: {
      ...project,
      currentVersion: {
        ...project.currentVersion,
        renderUrl: undefined,
        status: "draft" as const,
        scenes
      }
    },
    failures
  };
}
