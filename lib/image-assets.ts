import OpenAI from "openai";
import sharp from "sharp";
import { generateCloudflareImage, hasCloudflareAI } from "@/lib/cloudflare-ai";
import { getOptionalEnv } from "@/lib/env";
import {
  projectVisualIdentity,
  sceneImagePrompt,
  stableImageSeed,
  type ImageReferenceRole
} from "@/lib/image-continuity";
import { assetUrlForKey, getFromR2, uploadToR2 } from "@/lib/r2";
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

function buildSceneImagePrompt(
  scene: Scene,
  project: Project,
  references: Array<{ role: "current" | "anchor" }>
) {
  return sceneImagePrompt(scene, project, references.map((reference) => reference.role));
}

function buildBrandSafeImagePrompt(scene: Scene, project: Project) {
  return [
    `Create a brand-safe 16:9 cinematic key visual for the product video "${project.title}".`,
    projectVisualIdentity(project),
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
type ImageReference = {
  body: Buffer;
  contentType: "image/jpeg";
  role: ImageReferenceRole;
  r2Key: string;
};

async function loadImageReference(asset: SceneAsset | undefined, role: ImageReference["role"]) {
  if (!asset?.r2Key) return undefined;
  try {
    const stored = await getFromR2(asset.r2Key);
    const bytes = stored.body
      ? Buffer.from(await stored.body.transformToByteArray())
      : undefined;
    if (!bytes?.length) return undefined;
    const body = await sharp(bytes)
      .rotate()
      .resize(512, 288, { fit: "cover" })
      .jpeg({ quality: 82, chromaSubsampling: "4:2:0" })
      .toBuffer();
    return { body, contentType: "image/jpeg", role, r2Key: asset.r2Key } satisfies ImageReference;
  } catch (error) {
    console.warn(`[image-assets] Could not prepare reference ${asset.r2Key}:`, error);
    return undefined;
  }
}

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
  quality: ImageQuality,
  references: ImageReference[]
): Promise<{ asset: SceneAsset; reference: ImageReference } | undefined> {
  const usableReferences = hasCloudflareAI() ? references : [];
  let prompt = buildSceneImagePrompt(scene, project, usableReferences);
  let body: Buffer;
  let model: string;
  if (hasCloudflareAI()) {
    let generated;
    try {
      generated = await generateCloudflareImage(prompt, quality, {
        seed: stableImageSeed(`${project.id}:${scene.sceneNumber}`),
        references: usableReferences
      });
    } catch (error) {
      if (!isSafetyFiltered(error)) throw error;
      prompt = buildBrandSafeImagePrompt(scene, project);
      generated = await generateCloudflareImage(prompt, quality, {
        seed: stableImageSeed(`${project.id}:${scene.sceneNumber}`),
        references: usableReferences.filter((reference) => reference.role === "anchor")
      });
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

  const asset: SceneAsset = {
    id: crypto.randomUUID(),
    type: "image",
    r2Key: uploaded.key,
    url: assetUrlForKey(uploaded.key, uploaded.publicUrl),
    metadata: {
      source: "generated-image",
      model,
      quality,
      prompt,
      seed: stableImageSeed(`${project.id}:${scene.sceneNumber}`),
      referenceKeys: usableReferences.map((reference) => reference.r2Key),
      sceneNumber: scene.sceneNumber
    }
  };
  const referenceBody = await sharp(body)
    .rotate()
    .resize(512, 288, { fit: "cover" })
    .jpeg({ quality: 82, chromaSubsampling: "4:2:0" })
    .toBuffer();
  return {
    asset,
    reference: { body: referenceBody, contentType: "image/jpeg", role: "anchor", r2Key: uploaded.key }
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
        renderUrl: undefined,
        status: "draft" as const,
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
  if (selectedIndexes.length === 0) return project;
  const concurrency = Math.min(3, Math.max(1, Number(getOptionalEnv("IMAGE_GENERATION_CONCURRENCY")) || 2));
  const firstExistingImage = scenes
    .flatMap((scene) => scene.assets.filter((asset) => asset.type === "image" && asset.url))
    .find(Boolean);
  let projectAnchor = await loadImageReference(firstExistingImage, "anchor");
  const targets = [...selectedIndexes];

  if (!projectAnchor && targets.length > 0) {
    const anchorTarget = targets.shift()!;
    try {
      const currentReference = await loadImageReference(
        anchorTarget.scene.assets.find((asset) => asset.type === "image" && asset.url),
        "current"
      );
      const generated = await generateSceneImage(
        anchorTarget.scene,
        project,
        options.quality ?? "standard",
        currentReference ? [currentReference] : []
      );
      if (generated) {
        const existingAssets = options.replaceExistingImages
          ? anchorTarget.scene.assets.filter((asset) => !["image", "clip"].includes(asset.type))
          : anchorTarget.scene.assets;
        scenes[anchorTarget.index] = { ...anchorTarget.scene, assets: [generated.asset, ...existingAssets] };
        projectAnchor = generated.reference;
      }
    } catch (error) {
      failures.push(classifyImageError(error));
      console.error(`[image-assets] Anchor scene ${anchorTarget.scene.sceneNumber} image generation failed:`, error);
    }
  }

  await mapWithConcurrency(targets, concurrency, async ({ scene, index }) => {
      try {
        const currentReference = await loadImageReference(
          scene.assets.find((asset) => asset.type === "image" && asset.url),
          "current"
        );
        const references = [
          currentReference,
          projectAnchor && projectAnchor.r2Key !== currentReference?.r2Key ? projectAnchor : undefined
        ].filter(Boolean) as ImageReference[];
        const generated = await generateSceneImage(scene, project, options.quality ?? "standard", references);
        if (!generated) return;

        const existingAssets = options.replaceExistingImages
          ? scene.assets.filter((asset) => !["image", "clip"].includes(asset.type))
          : scene.assets;

        scenes[index] = { ...scene, assets: [generated.asset, ...existingAssets] };
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
      renderUrl: undefined,
      status: "draft",
      assetStatus,
      assetErrorCode: failures[0],
      scenes
    }
  };
}
