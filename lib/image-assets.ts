import OpenAI from "openai";
import { getOptionalEnv } from "@/lib/env";
import { assetUrlForKey, uploadToR2 } from "@/lib/r2";
import type { Project, Scene, SceneAsset } from "@/lib/types";

function imageCredentialIssue(): "missing_key" | "invalid_key" | undefined {
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

async function generateSceneImage(scene: Scene, project: Project): Promise<SceneAsset | undefined> {
  const client = new OpenAI({ apiKey: getOptionalEnv("OPENAI_API_KEY") });
  const prompt = buildSceneImagePrompt(scene, project.title);

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

  const key = `generated/${project.id}/${project.currentVersion.id}/scene-${scene.sceneNumber}-${crypto.randomUUID()}.png`;
  const uploaded = await uploadToR2({
    key,
    body: Buffer.from(base64, "base64"),
    contentType: "image/png"
  });

  return {
    id: crypto.randomUUID(),
    type: "image",
    r2Key: uploaded.key,
    url: assetUrlForKey(uploaded.key, uploaded.publicUrl),
    metadata: {
      source: "ai-image",
      model: imageModel(),
      prompt,
      sceneNumber: scene.sceneNumber
    }
  };
}

export async function generateProjectSceneImages(
  project: Project,
  options: { replaceExistingImages?: boolean; sceneNumbers?: number[] } = {}
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
  const scenes = await Promise.all(
    project.currentVersion.scenes.map(async (scene) => {
      if (selectedScenes && !selectedScenes.has(scene.sceneNumber)) return scene;

      try {
        const image = await generateSceneImage(scene, project);
        if (!image) return scene;

        const existingAssets = options.replaceExistingImages
          ? scene.assets.filter((asset) => asset.type !== "image")
          : scene.assets;

        return { ...scene, assets: [image, ...existingAssets] };
      } catch (error) {
        failures.push(classifyImageError(error));
        console.error(`[image-assets] Scene ${scene.sceneNumber} image generation failed:`, error);
        return scene;
      }
    })
  );

  const imageCount = scenes.filter((scene) => scene.assets.some((asset) => asset.type === "image")).length;
  const assetStatus: NonNullable<Project["currentVersion"]["assetStatus"]> =
    imageCount === scenes.length ? "ready" : imageCount > 0 ? "partial" : "failed";

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
