import OpenAI from "openai";
import { getOptionalEnv } from "@/lib/env";
import { assetUrlForKey, uploadToR2 } from "@/lib/r2";
import type { Project, Scene, SceneAsset } from "@/lib/types";

function canGenerateImages() {
  return Boolean(getOptionalEnv("OPENAI_API_KEY"));
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
    "Make it cinematic and concrete, with strong composition, depth, premium lighting, and clear subject focus.",
    "Prefer expressive product UI, spatial layers, real workflow objects, and branded-but-generic visual polish.",
    "Avoid clutter, lorem ipsum, random text, fake logos, watermarks, distorted interface text, and generic abstract cards."
  ].join("\n");
}

async function generateSceneImage(scene: Scene, project: Project): Promise<SceneAsset | undefined> {
  if (!canGenerateImages()) return undefined;

  const client = new OpenAI({ apiKey: getOptionalEnv("OPENAI_API_KEY") });
  const prompt = buildSceneImagePrompt(scene, project.title);

  const result = await client.images.generate({
    model: imageModel(),
    prompt,
    size: "1536x1024",
    quality: "low",
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
  if (!canGenerateImages()) return project;

  const selectedScenes = options.sceneNumbers ? new Set(options.sceneNumbers) : undefined;
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
        console.error(`[image-assets] Scene ${scene.sceneNumber} image generation failed:`, error);
        return scene;
      }
    })
  );

  return {
    ...project,
    currentVersion: {
      ...project.currentVersion,
      scenes
    }
  };
}
