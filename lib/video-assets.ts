import { generateCloudflareVideo, hasCloudflareAI } from "@/lib/cloudflare-ai";
import { stableImageSeed } from "@/lib/image-continuity";
import { assetUrlForKey, uploadToR2 } from "@/lib/r2";
import type { Project, Scene, SceneAsset } from "@/lib/types";
import { GeneratedVideoQualityError, inspectGeneratedVideo } from "@/lib/video-quality";

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
  quality: "standard" | "premium";
}) {
  const image = input.scene.assets.find((asset) => asset.type === "image" && asset.url);
  if (!image) throw new Error("Scene has no reference image for video generation");
  const prompt = sceneVideoPrompt(input.scene, input.project);
  const duration = Math.min(15, Math.max(3, Math.round(input.scene.durationSeconds)));
  const baseSeed = stableImageSeed(`${input.project.id}:${input.scene.sceneNumber}:video`);
  let generated: Awaited<ReturnType<typeof generateCloudflareVideo>> | undefined;
  let videoMetadata: Awaited<ReturnType<typeof inspectGeneratedVideo>> | undefined;
  let seed = baseSeed;
  let effectivePrompt = prompt;
  for (let qualityAttempt = 0; qualityAttempt < 2; qualityAttempt += 1) {
    seed = (baseSeed + qualityAttempt * 130_363) % 2_147_483_647 || 1;
    effectivePrompt = qualityAttempt === 0
      ? prompt
      : `${prompt}\nQuality correction: render a complete ${duration}-second continuous shot with stable subjects, resolved motion throughout the full duration, and no frozen or empty frames.`;
    try {
      generated = await generateCloudflareVideo({
        imageUrl: absoluteAssetUrl(image.url, input.assetBaseUrl),
        prompt: effectivePrompt,
        duration,
        resolution: input.quality === "premium" ? "1080P" : "720P",
        seed
      });
      videoMetadata = await inspectGeneratedVideo(generated.body, duration);
      break;
    } catch (error) {
      if (!(error instanceof GeneratedVideoQualityError) || qualityAttempt === 1) throw error;
      console.warn(`[video-assets] Scene ${input.scene.sceneNumber} video failed quality validation; retrying:`, error.message);
    }
  }
  if (!generated || !videoMetadata) throw new GeneratedVideoQualityError("动态镜头没有生成可用的视频文件。");
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
      quality: input.quality,
      resolution: input.quality === "premium" ? "1080P" : "720P",
      ...videoMetadata,
      prompt: effectivePrompt,
      seed,
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
    quality?: "standard" | "premium";
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
        quality: input.quality ?? "standard"
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
