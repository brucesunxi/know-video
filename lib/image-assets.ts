import OpenAI from "openai";
import sharp from "sharp";
import { detectCloudflareImageText, generateCloudflareImage, hasCloudflareAI } from "@/lib/cloudflare-ai";
import { sceneReferenceAssets } from "@/lib/attachment-context";
import { getOptionalEnv } from "@/lib/env";
import {
  enforceTextFreeImagePrompt,
  imageSafeSemanticText,
  projectVisualIdentity,
  sceneRequiresPremiumImage,
  sceneImagePrompt,
  stableImageSeed
} from "@/lib/image-continuity";
import { GeneratedImageQualityError, normalizeGeneratedImage } from "@/lib/image-quality";
import { mediaAssetStatus } from "@/lib/generation-resume";
import { assetUrlForKey, getFromR2, uploadToR2 } from "@/lib/r2";
import type { Project, Scene, SceneAsset } from "@/lib/types";
import { exactVisualStyleDirection } from "@/lib/visual-style-profiles";

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
  references: Array<{ role: "current" }>,
  visualInstruction?: string
) {
  return sceneImagePrompt(scene, project, references.map((reference) => reference.role), visualInstruction);
}

function buildBrandSafeImagePrompt(scene: Scene, project: Project) {
  return enforceTextFreeImagePrompt([
    `Create a brand-safe 16:9 cinematic key visual for the commercial film "${imageSafeSemanticText(project.title)}".`,
    projectVisualIdentity(project),
    exactVisualStyleDirection(scene.style),
    `Scene ${scene.sceneNumber}: ${imageSafeSemanticText(scene.title)}.`,
    `Scene meaning: ${imageSafeSemanticText(scene.voiceover)} ${imageSafeSemanticText(scene.visualPrompt)}`,
    "Use a brand-neutral educational or commercial scene with concrete subject matter and purposeful action, rendered only in the locked style above.",
    `Mood: ${scene.style.mood}. Palette: ${scene.style.palette.join(", ")}.`,
    "Premium commercial art direction, strong depth, one clear focal point, refined lighting, and generous negative space.",
    "Do not depict identifiable people, faces, children, weapons, conflict, politics, medical content, dashboards, presentation slides, floating UI cards, protected characters, official game logos, or brand marks."
  ].join("\n"));
}

function buildUltraSafeSceneImagePrompt(scene: Scene, project: Project) {
  return enforceTextFreeImagePrompt([
    "Create a safe 16:9 educational commercial background plate.",
    `Topic: ${imageSafeSemanticText(project.title)}.`,
    `Scene ${scene.sceneNumber}: ${imageSafeSemanticText(scene.title)}.`,
    exactVisualStyleDirection(scene.style),
    `Meaning to visualize: ${imageSafeSemanticText(scene.voiceover)}.`,
    semanticFallbackComposition(scene),
    `Mood: ${scene.style.mood}. Palette: ${scene.style.palette.join(", ")}.`,
    "Use safe scene-specific learning objects, product props, paths and environment details, all rendered only in the locked style above.",
    "No recognizable brands, logos, readable text, real minors, faces, copyrighted characters, weapons, harm, conflict, or sensitive content."
  ].join("\n"));
}

function buildTextSafeCorrectionPrompt(scene: Scene, project: Project) {
  return enforceTextFreeImagePrompt([
    `Create a polished 16:9 scene illustration for ${imageSafeSemanticText(project.title)}.`,
    projectVisualIdentity(project),
    exactVisualStyleDirection(scene.style),
    `Scene meaning: ${imageSafeSemanticText(scene.voiceover)} ${imageSafeSemanticText(scene.visualPrompt)}`,
    semanticFallbackComposition(scene),
    `Mood: ${scene.style.mood}. Palette: ${scene.style.palette.join(", ")}.`,
    "Build the meaning with recognizable people, environments, actions, and physical objects instead of written information.",
    "TEXT-SAFE COMPOSITION: do not include screens, phones facing camera, documents, books, signs, posters, whiteboards, blackboards, dashboards, charts, diagrams, forms, packaging, badges, uniforms with markings, storefronts, vehicle markings, or decorative glyphs.",
    "Use natural scene depth and a single clear action. Keep all surfaces plain and uninterrupted. Do not arrange blank rectangles or lines in a way that resembles an interface, document, chart, or writing.",
    "The final frame must remain rich and specific to this scene while containing no typography or writing-like marks."
  ].join("\n"));
}

function semanticFallbackComposition(scene: Scene) {
  const description = `${scene.title}\n${scene.voiceover}\n${scene.visualPrompt}`;
  if (/(?:方块|沙盒|游戏|课程|编程|voxel|sandbox|game|course|programming)/iu.test(description)) {
    return "Composition: a different voxel-learning beat for this scene, such as a planning desk with unlabeled colored blocks, an abstract block-building workspace, a simple logic circuit made of cubes and light paths, or a finished voxel world display with no characters or logos.";
  }
  if (/(?:库存|仓库|物流|订单|跨境|inventory|warehouse|logistics|order)/iu.test(description)) {
    return "Composition: a clear abstract operations map with warehouse nodes, parcels, route lines, inventory groups, and cause-and-effect flow, all unlabeled.";
  }
  return "Composition: a scene-specific metaphor with a distinct foreground object, middle-ground action, and background environment that matches the narration.";
}

function isSafetyFiltered(error: unknown) {
  return (error as { code?: string }).code === "3030";
}

type ImageQuality = "standard" | "premium";
type ImageReference = {
  body: Buffer;
  contentType: "image/jpeg";
  role: "current";
  r2Key: string;
};

async function generatedImageContainsText(body: Buffer) {
  try {
    if (hasCloudflareAI()) return (await detectCloudflareImageText(body)).hasText;
    const client = new OpenAI({ apiKey: getOptionalEnv("OPENAI_API_KEY") });
    const response = await client.chat.completions.create({
      model: getOptionalEnv("OPENAI_VISION_MODEL") || "gpt-4o-mini",
      temperature: 0,
      max_tokens: 8,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Inspect the entire image. Answer TEXT_PRESENT when there is readable text, a logo, watermark, signature, or a clustered sequence of fake or scrambled characters clearly intended to look like writing. Do not classify ordinary object outlines, connector lines, isolated geometric marks, facial features, texture strokes, or unlabeled pictorial icons as text. Answer exactly TEXT_PRESENT or TEXT_FREE." },
          { type: "image_url", image_url: { url: `data:image/png;base64,${body.toString("base64")}`, detail: "high" } }
        ]
      }]
    } as never);
    const verdict = response.choices[0]?.message?.content?.toUpperCase() ?? "";
    if (verdict.includes("TEXT_PRESENT")) return true;
    if (verdict.includes("TEXT_FREE")) return false;
    throw new Error("Vision model returned an inconclusive text inspection");
  } catch (error) {
    throw new GeneratedImageQualityError("无法确认生成画面是否完全无文字。", "text_check_failed", { cause: error });
  }
}

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
): Promise<{ asset: SceneAsset } | undefined> {
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
  for (let qualityAttempt = 0; qualityAttempt < 3; qualityAttempt += 1) {
    seed = (baseSeed + qualityAttempt * 104_729) % 2_147_483_647 || 1;
    const attemptPrompt = qualityAttempt === 2
      ? buildTextSafeCorrectionPrompt(scene, project)
      : enforceTextFreeImagePrompt(qualityAttempt === 0
        ? prompt
        : `${prompt}\nQuality correction attempt ${qualityAttempt + 1}: the prior candidate was rejected. Rebuild the composition as a fully resolved, information-rich frame in the exact locked rendering medium. Remove every word, letter, number, logo, watermark, fake glyph, and writing-like mark; use blank surfaces and purely pictorial objects instead. Keep clear subject separation and meaningful foreground, midground, and background. Do not switch to photography, 3D, voxel, low-poly, or another illustration style. Avoid empty gradients or featureless surfaces.`);
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
          try {
            generated = await generateCloudflareImage(effectivePrompt, effectiveQuality, { seed });
          } catch (fallbackError) {
            if (!isSafetyFiltered(fallbackError)) throw fallbackError;
            effectivePrompt = buildUltraSafeSceneImagePrompt(scene, project);
            generated = await generateCloudflareImage(effectivePrompt, effectiveQuality, {
              seed: (seed + 7_919) % 2_147_483_647 || 1,
              guidance: 3
            });
          }
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
      if (await generatedImageContainsText(normalized.body)) {
        throw new GeneratedImageQualityError("生成画面包含文字或类似文字的符号。", "text_detected");
      }
      body = normalized.body;
      qualityMetadata = normalized.metadata;
      model = generatedModel;
      prompt = effectivePrompt;
      break;
    } catch (error) {
      if (!(error instanceof GeneratedImageQualityError) || qualityAttempt === 2) throw error;
      console.warn(`[image-assets] Scene ${scene.sceneNumber} image failed quality validation (${error.code}); retrying:`, error.message);
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
  return { asset };
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
  const targets = [...selectedIndexes];

  await mapWithConcurrency(targets, concurrency, async ({ scene, index }) => {
      try {
        const currentReference = await loadSceneImageReference(scene, "current");
        const references = [currentReference].filter(Boolean) as ImageReference[];
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
        const qualityCode = error instanceof GeneratedImageQualityError ? error.code : undefined;
        console.error(`[image-assets] Scene ${scene.sceneNumber} image generation failed${qualityCode ? ` (${qualityCode})` : ""}:`, error);
        failures.push(classifyImageError(error));
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
