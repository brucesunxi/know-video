import OpenAI from "openai";
import sharp from "sharp";
import { generateCloudflareImage, hasCloudflareAI } from "@/lib/cloudflare-ai";
import { sceneReferenceAssets } from "@/lib/attachment-context";
import { getOptionalEnv } from "@/lib/env";
import {
  enforceTextFreeImagePrompt,
  projectVisualIdentity,
  sceneRequiresPremiumImage,
  sceneImagePrompt,
  selectVisualAnchorScene,
  stableImageSeed,
  type ImageReferenceRole
} from "@/lib/image-continuity";
import { GeneratedImageQualityError, normalizeGeneratedImage } from "@/lib/image-quality";
import { mediaAssetStatus } from "@/lib/generation-resume";
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
  references: Array<{ role: "current" | "anchor" }>,
  visualInstruction?: string
) {
  return sceneImagePrompt(scene, project, references.map((reference) => reference.role), visualInstruction);
}

function buildBrandSafeImagePrompt(scene: Scene, project: Project) {
  return enforceTextFreeImagePrompt([
    `Create a brand-safe 16:9 cinematic key visual for the commercial film "${project.title}".`,
    projectVisualIdentity(project),
    `Scene ${scene.sceneNumber}: ${scene.title}.`,
    `Use an elegant abstract visual metaphor built from architecture, light, layered materials, and purposeful motion.`,
    `Mood: ${scene.style.mood}. Palette: ${scene.style.palette.join(", ")}.`,
    "Premium commercial art direction, strong depth, one clear focal point, refined lighting, and generous negative space.",
    "Do not depict people, faces, bodies, weapons, conflict, politics, medical content, dashboards, presentation slides, or floating UI cards."
  ].join("\n"));
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

async function loadSceneImageReference(scene: Scene, role: ImageReference["role"]) {
  const uploadedImage = sceneReferenceAssets(scene).find((reference) => reference.contentType.startsWith("image/"));
  if (uploadedImage) {
    return loadImageReference({
      id: `reference:${uploadedImage.key}`,
      type: "image",
      r2Key: uploadedImage.key,
      url: "",
      metadata: {
        source: "user-upload",
        name: uploadedImage.name,
        size: uploadedImage.size,
        contentType: uploadedImage.contentType
      }
    }, role);
  }
  return loadImageReference(
    scene.assets.find((asset) => asset.type === "image" && asset.url),
    role
  );
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
  references: ImageReference[],
  variantKey = "primary",
  visualInstruction?: string
): Promise<{ asset: SceneAsset; reference: ImageReference } | undefined> {
  const effectiveQuality: ImageQuality = quality === "premium" || sceneRequiresPremiumImage(scene)
    ? "premium"
    : "standard";
  const usableReferences = hasCloudflareAI() ? references : [];
  const baseSeed = stableImageSeed(`${project.id}:${scene.sceneNumber}:${variantKey}`);
  let prompt = buildSceneImagePrompt(scene, project, usableReferences, visualInstruction);
  let body: Buffer | undefined;
  let model = "";
  let seed = baseSeed;
  let qualityMetadata: Awaited<ReturnType<typeof normalizeGeneratedImage>>["metadata"] | undefined;
  for (let qualityAttempt = 0; qualityAttempt < 2; qualityAttempt += 1) {
    seed = (baseSeed + qualityAttempt * 104_729) % 2_147_483_647 || 1;
    const attemptPrompt = enforceTextFreeImagePrompt(qualityAttempt === 0
      ? prompt
      : `${prompt}\nQuality correction: produce a fully resolved, information-rich cinematic frame with clear subject separation, detailed materials, and meaningful foreground, midground, and background. Avoid empty gradients or featureless surfaces.`);
    let generatedBody: Buffer;
    let generatedModel: string;
    let effectivePrompt = attemptPrompt;
    try {
      if (hasCloudflareAI()) {
        let generated;
        try {
          generated = await generateCloudflareImage(attemptPrompt, effectiveQuality, {
            seed,
            references: usableReferences
          });
        } catch (error) {
          if (!isSafetyFiltered(error)) throw error;
          effectivePrompt = buildBrandSafeImagePrompt(scene, project);
          generated = await generateCloudflareImage(effectivePrompt, effectiveQuality, {
            seed,
            references: usableReferences.filter((reference) => reference.role === "anchor")
          });
        }
        generatedBody = generated.body;
        generatedModel = generated.model;
      } else {
        const client = new OpenAI({ apiKey: getOptionalEnv("OPENAI_API_KEY") });
        const result = await client.images.generate({
          model: imageModel(),
          prompt: attemptPrompt,
          size: "1536x1024",
          quality: "medium",
          n: 1
        } as never);
        const image = result.data?.[0];
        const base64 = image ? (image as { b64_json?: string }).b64_json : undefined;
        if (!base64) return undefined;
        generatedBody = Buffer.from(base64, "base64");
        generatedModel = imageModel();
      }
      const normalized = await normalizeGeneratedImage(generatedBody);
      body = normalized.body;
      qualityMetadata = normalized.metadata;
      model = generatedModel;
      prompt = effectivePrompt;
      break;
    } catch (error) {
      if (!(error instanceof GeneratedImageQualityError) || qualityAttempt === 1) throw error;
      console.warn(`[image-assets] Scene ${scene.sceneNumber} image failed quality validation; retrying:`, error.message);
    }
  }
  if (!body || !qualityMetadata) return undefined;

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
      quality: effectiveQuality,
      prompt,
      seed,
      ...qualityMetadata,
      referenceKeys: usableReferences.map((reference) => reference.r2Key),
      candidateInstruction: visualInstruction || undefined,
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
  options: {
    replaceExistingImages?: boolean;
    sceneNumbers?: number[];
    quality?: ImageQuality;
    candidate?: boolean;
    variantKey?: string;
    visualInstruction?: string;
  } = {}
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
  const existingAnchorScene = selectVisualAnchorScene(
    scenes.filter((scene) => (
      scene.assets.some((asset) => asset.type === "image" && asset.url)
      || sceneReferenceAssets(scene).some((reference) => reference.contentType.startsWith("image/"))
    ))
  );
  let projectAnchor = existingAnchorScene
    ? await loadSceneImageReference(existingAnchorScene, "anchor")
    : undefined;
  const targets = [...selectedIndexes];

  if (!projectAnchor && targets.length > 0) {
    const preferredAnchor = selectVisualAnchorScene(targets.map((target) => target.scene));
    const anchorIndex = Math.max(0, targets.findIndex((target) => target.scene.id === preferredAnchor?.id));
    const [anchorTarget] = targets.splice(anchorIndex, 1);
    try {
      const currentReference = await loadSceneImageReference(anchorTarget.scene, "current");
      const generated = await generateSceneImage(
        anchorTarget.scene,
        project,
        options.quality ?? "standard",
        currentReference ? [currentReference] : [],
        options.variantKey,
        options.visualInstruction
      );
      if (generated) {
        const generatedAsset = options.candidate ? {
          ...generated.asset,
          type: "thumbnail" as const,
          metadata: { ...generated.asset.metadata, candidate: true }
        } : generated.asset;
        const existingAssets = options.replaceExistingImages
          ? anchorTarget.scene.assets.filter((asset) => !["image", "clip"].includes(asset.type))
          : anchorTarget.scene.assets;
        scenes[anchorTarget.index] = {
          ...anchorTarget.scene,
          assets: options.candidate ? [...existingAssets, generatedAsset] : [generatedAsset, ...existingAssets]
        };
        projectAnchor = generated.reference;
      }
    } catch (error) {
      failures.push(classifyImageError(error));
      console.error(`[image-assets] Anchor scene ${anchorTarget.scene.sceneNumber} image generation failed:`, error);
    }
  }

  await mapWithConcurrency(targets, concurrency, async ({ scene, index }) => {
      try {
        const currentReference = await loadSceneImageReference(scene, "current");
        const references = [
          currentReference,
          projectAnchor && projectAnchor.r2Key !== currentReference?.r2Key ? projectAnchor : undefined
        ].filter(Boolean) as ImageReference[];
        const generated = await generateSceneImage(
          scene,
          project,
          options.quality ?? "standard",
          references,
          options.variantKey,
          options.visualInstruction
        );
        if (!generated) return;

        const generatedAsset = options.candidate ? {
          ...generated.asset,
          type: "thumbnail" as const,
          metadata: { ...generated.asset.metadata, candidate: true }
        } : generated.asset;

        const existingAssets = options.replaceExistingImages
          ? scene.assets.filter((asset) => !["image", "clip"].includes(asset.type))
          : scene.assets;

        scenes[index] = {
          ...scene,
          assets: options.candidate ? [...existingAssets, generatedAsset] : [generatedAsset, ...existingAssets]
        };
      } catch (error) {
        failures.push(classifyImageError(error));
        console.error(`[image-assets] Scene ${scene.sceneNumber} image generation failed:`, error);
      }
  });

  const assetStatus = mediaAssetStatus(scenes);

  return {
    ...project,
    currentVersion: {
      ...project.currentVersion,
      renderUrl: options.candidate ? project.currentVersion.renderUrl : undefined,
      renderJobId: options.candidate ? project.currentVersion.renderJobId : undefined,
      status: options.candidate ? project.currentVersion.status : "draft",
      assetStatus,
      assetErrorCode: failures[0],
      scenes
    }
  };
}
