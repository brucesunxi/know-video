import OpenAI from "openai";
import { generateCloudflareImage, hasCloudflareAI } from "@/lib/cloudflare-ai";
import { getOptionalEnv } from "@/lib/env";
import { assetUrlForKey, uploadToR2 } from "@/lib/r2";
import type { Project, Scene, SceneAsset } from "@/lib/types";

function imageCredentialIssue(): "missing_key" | "invalid_key" | undefined {
  if (hasCloudflareAI()) return undefined;
  const apiKey = getOptionalEnv("OPENAI_API_KEY");
  if (!apiKey) return "missing_key";
  if (!apiKey.startsWith("sk-")) return "invalid_key";
  return undefined;
}

function classifyImageError(error: unknown): NonNullable<Project["currentVersion"]["assetErrorCode"]> {
  const candidate = error as { status?: number; code?: string; name?: string };
  if (candidate.status === 401 || candidate.code === "invalid_api_key") return "invalid_key";
  if (candidate.name?.includes("S3") || candidate.code?.includes("Bucket")) return "storage_failed";
  return "generation_failed";
}

function imageModel() {
  return getOptionalEnv("OPENAI_IMAGE_MODEL") || "gpt-image-2";
}

function buildSceneImagePrompt(scene: Scene, projectTitle: string) {
  const palette = scene.style.palette.join(", ");

  return [
    `Create a polished 16:9 key visual for a scene in a product video called "${projectTitle}".`,
    `Scene ${scene.sceneNumber}: ${scene.title}.`,
    `Visual direction: ${scene.visualPrompt}`,
    `Motion direction to imply: ${scene.motionPrompt}`,
    `Mood: ${scene.style.mood}. Theme: ${scene.style.theme}. Palette: ${palette}.`,
    "Make it a finished cinematic frame rather than a wireframe or a presentation slide: strong composition, depth, premium lighting, and one clear subject.",
    "Show the actual human workflow, device, environment, and product interaction described by the scene. Use spatial layers and purposeful visual storytelling.",
    "Use little or no text inside the generated image. Never show prompt instructions, layout annotations, labels, lorem ipsum, fake logos, watermarks, or generic floating cards.",
    "Keep important subjects inside a 16:9 center-safe area so the 3:2 source can be cropped cleanly."
  ].join("\n");
}

function buildBrandSafeImagePrompt(scene: Scene, projectTitle: string) {
  return [
    `Create a brand-safe 16:9 cinematic key visual for the product video "${projectTitle}".`,
    `Scene ${scene.sceneNumber}: ${scene.title}.`,
    `Use an elegant abstract visual metaphor built from architecture, light, layered materials, and purposeful motion.`,
    `Mood: ${scene.style.mood}. Palette: ${scene.style.palette.join(", ")}.`,
    "Premium commercial art direction, strong depth, one clear focal point, refined lighting, and generous negative space.",
    "Do not depict people, faces, bodies, weapons, conflict, politics, medical content, brands, logos, readable text, dashboards, presentation slides, or floating UI cards."
  ].join("\n");
}

function isSafetyFiltered(error: unknown) {
  return (error as { code?: string }).code === "3030";
}

type ImageQuality = "standard" | "premium";

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
) {
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
}

async function generateSceneImage(
  scene: Scene,
  project: Project,
  quality: ImageQuality
): Promise<SceneAsset | undefined> {
  let prompt = buildSceneImagePrompt(scene, project.title);
  let body: Buffer;
  let model: string;
  if (hasCloudflareAI()) {
    let generated;
    try {
      generated = await generateCloudflareImage(prompt, quality);
    } catch (error) {
      if (!isSafetyFiltered(error)) throw error;
      prompt = buildBrandSafeImagePrompt(scene, project.title);
      generated = await generateCloudflareImage(prompt, quality);
    }
    body = generated.body;
    model = generated.model;
  } else {
    const client = new OpenAI({ apiKey: getOptionalEnv("OPENAI_API_KEY") });
    const result = await client.images.generate({
      model: imageModel(),
      prompt,
      size: "1536x1024",
      quality: "medium",
      n: 1
    } as never);
    const image = result.data?.[0];
    const base64 = image ? (image as { b64_json?: string }).b64_json : undefined;
    if (!base64) return undefined;
    body = Buffer.from(base64, "base64");
    model = imageModel();
  }

  const key = `generated/${project.id}/${project.currentVersion.id}/scene-${scene.sceneNumber}-${crypto.randomUUID()}.png`;
  const uploaded = await uploadToR2({
    key,
    body,
    contentType: "image/png"
  });

  return {
    id: crypto.randomUUID(),
    type: "image",
    r2Key: uploaded.key,
    url: assetUrlForKey(uploaded.key, uploaded.publicUrl),
    metadata: {
      source: "generated-image",
      model,
      quality,
      prompt,
      sceneNumber: scene.sceneNumber
    }
  };
}

export async function generateProjectSceneImages(
  project: Project,
  options: { replaceExistingImages?: boolean; sceneNumbers?: number[]; quality?: ImageQuality } = {}
) {
  const credentialIssue = imageCredentialIssue();
  if (credentialIssue) {
    return {
      ...project,
      currentVersion: {
        ...project.currentVersion,
        assetStatus: "failed" as const,
        assetErrorCode: credentialIssue
      }
    };
  }

  const selectedScenes = options.sceneNumbers ? new Set(options.sceneNumbers) : undefined;
  const failures: NonNullable<Project["currentVersion"]["assetErrorCode"]>[] = [];
  const scenes = [...project.currentVersion.scenes];
  const selectedIndexes = scenes
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) => !selectedScenes || selectedScenes.has(scene.sceneNumber));
  const concurrency = Math.min(3, Math.max(1, Number(getOptionalEnv("IMAGE_GENERATION_CONCURRENCY")) || 2));
  await mapWithConcurrency(selectedIndexes, concurrency, async ({ scene, index }) => {
      try {
        const image = await generateSceneImage(scene, project, options.quality ?? "standard");
        if (!image) return;

        const existingAssets = options.replaceExistingImages
          ? scene.assets.filter((asset) => !["image", "clip"].includes(asset.type))
          : scene.assets;

        scenes[index] = { ...scene, assets: [image, ...existingAssets] };
      } catch (error) {
        failures.push(classifyImageError(error));
        console.error(`[image-assets] Scene ${scene.sceneNumber} image generation failed:`, error);
      }
  });

  const visualCount = scenes.filter((scene) => scene.assets.some((asset) => ["image", "clip"].includes(asset.type))).length;
  const assetStatus: NonNullable<Project["currentVersion"]["assetStatus"]> =
    visualCount === scenes.length ? "ready" : visualCount > 0 ? "partial" : "failed";

  return {
    ...project,
    currentVersion: {
      ...project.currentVersion,
      assetStatus,
      assetErrorCode: failures[0],
      scenes
    }
  };
}
