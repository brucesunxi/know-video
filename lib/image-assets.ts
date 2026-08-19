import OpenAI from "openai";
import sharp from "sharp";
import { detectCloudflareImageText, generateCloudflareImage, hasCloudflareAI, inspectCloudflareGeneratedImage } from "@/lib/cloudflare-ai";
import { sceneReferenceAssets } from "@/lib/attachment-context";
import { getOptionalEnv } from "@/lib/env";
import {
  enforceTextFreeImagePrompt,
  imageSafeSemanticText,
  projectLockedVisualStyle,
  projectVisualIdentity,
  sceneRequiresPremiumImage,
  sceneImagePrompt,
  stableImageSeed,
  type ImageReferenceRole
} from "@/lib/image-continuity";
import { GeneratedImageQualityError, normalizeGeneratedImage } from "@/lib/image-quality";
import { ADJACENT_SCENE_DUPLICATE_THRESHOLD, imagePerceptualSimilarity } from "@/lib/image-similarity";
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
  references: Array<{ role: ImageReferenceRole }>,
  visualInstruction?: string
) {
  return sceneImagePrompt(scene, project, references.map((reference) => reference.role), visualInstruction);
}

function buildBrandSafeImagePrompt(scene: Scene, project: Project) {
  return enforceTextFreeImagePrompt([
    `Create a brand-safe 16:9 cinematic key visual for the commercial film "${imageSafeSemanticText(project.title)}".`,
    projectVisualIdentity(project),
    exactVisualStyleDirection(projectLockedVisualStyle(project) ?? scene.style),
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
    exactVisualStyleDirection(projectLockedVisualStyle(project) ?? scene.style),
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
    exactVisualStyleDirection(projectLockedVisualStyle(project) ?? scene.style),
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
  role: ImageReferenceRole;
  r2Key: string;
};

type SceneComparisonImage = {
  body: Buffer;
  sceneNumber: number;
};

type RecoverableImageQualityCode = Extract<
  GeneratedImageQualityError["code"],
  "style_mismatch" | "semantic_mismatch" | "semantic_check_failed"
>;

type TextFreeImageCandidate = {
  body: Buffer;
  metadata: Awaited<ReturnType<typeof normalizeGeneratedImage>>["metadata"];
  model: string;
  prompt: string;
  seed: number;
  warningCode: RecoverableImageQualityCode;
};

const recoverableCandidatePriority: Record<RecoverableImageQualityCode, number> = {
  style_mismatch: 3,
  semantic_check_failed: 2,
  semantic_mismatch: 1
};

function betterTextFreeCandidate(
  current: TextFreeImageCandidate | undefined,
  candidate: TextFreeImageCandidate
) {
  if (!current) return candidate;
  return recoverableCandidatePriority[candidate.warningCode] > recoverableCandidatePriority[current.warningCode]
    ? candidate
    : current;
}

function expectedSceneSemantics(scene: Scene, project: Project) {
  const lockedStyle = projectLockedVisualStyle(project) ?? scene.style;
  return [
    `Project subject: ${imageSafeSemanticText(project.title)}.`,
    `LOCKED VISUAL STYLE: ${exactVisualStyleDirection(lockedStyle) || `${lockedStyle.theme}; ${lockedStyle.mood}`}.`,
    `Scene ${scene.sceneNumber}: ${imageSafeSemanticText(scene.title)}.`,
    `Narrative meaning: ${imageSafeSemanticText(scene.voiceover)}.`,
    `Required visible content: ${imageSafeSemanticText(scene.visualPrompt)}.`
  ].join("\n").slice(0, 3600);
}

async function inspectGeneratedImage(body: Buffer, scene: Scene, project: Project) {
  const expected = expectedSceneSemantics(scene, project);
  try {
    if (hasCloudflareAI()) return (await inspectCloudflareGeneratedImage(body, expected)).verdict;
    const client = new OpenAI({ apiKey: getOptionalEnv("OPENAI_API_KEY") });
    const response = await client.chat.completions.create({
      model: getOptionalEnv("OPENAI_VISION_MODEL") || "gpt-4o-mini",
      temperature: 0,
      max_tokens: 16,
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "Inspect this generated film frame against the expected scene.",
              expected,
              "Return TEXT_PRESENT if there is readable text, a logo, watermark, signature, or clustered fake writing.",
              "Otherwise return STYLE_MISMATCH if the rendering medium conflicts with the LOCKED VISUAL STYLE, such as photography instead of illustration, line art instead of collage, or 3D instead of 2D.",
              "Otherwise return SEMANTIC_MISMATCH if the central subject, action, and setting are unrelated or unrecognizable, or the image is a palette, pattern sheet, material swatch, decorative geometry, generic background, split-screen montage, contact sheet, storyboard sheet, or style sample.",
              "Return IMAGE_PASS only when the image is text-free, follows the exact locked rendering medium, and its concrete visible meaning materially matches the scene.",
              "Answer exactly TEXT_PRESENT, STYLE_MISMATCH, SEMANTIC_MISMATCH, or IMAGE_PASS."
            ].join("\n")
          },
          { type: "image_url", image_url: { url: `data:image/png;base64,${body.toString("base64")}`, detail: "high" } }
        ]
      }]
    } as never);
    const verdict = response.choices[0]?.message?.content?.toUpperCase() ?? "";
    if (verdict.includes("TEXT_PRESENT")) return "text_present" as const;
    if (verdict.includes("STYLE_MISMATCH")) return "style_mismatch" as const;
    if (verdict.includes("SEMANTIC_MISMATCH")) return "semantic_mismatch" as const;
    if (verdict.includes("IMAGE_PASS")) return "pass" as const;
    throw new Error("Vision model returned an inconclusive generated-image inspection");
  } catch (error) {
    throw new GeneratedImageQualityError("无法确认生成画面的文字与场景质量。", "semantic_check_failed", { cause: error });
  }
}

async function generatedImageContainsAnyText(body: Buffer) {
  try {
    // Keep image generation and validation on Cloudflare when it is configured.
    // Falling through to OpenAI here can reject otherwise valid Cloudflare output
    // because of an unrelated OpenAI quota or billing issue.
    if (hasCloudflareAI()) return (await detectCloudflareImageText(body)).hasText;
    const apiKey = getOptionalEnv("OPENAI_API_KEY");
    if (apiKey?.startsWith("sk-")) {
      const client = new OpenAI({ apiKey });
      const response = await client.chat.completions.create({
        model: getOptionalEnv("OPENAI_VISION_MODEL") || "gpt-4o-mini",
        temperature: 0,
        max_tokens: 12,
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "Perform a high-recall text inspection over the entire image.",
                "Return TEXT_PRESENT if any visible region contains a word, letter, number, caption, headline, sign, label, logo, watermark, signature, interface copy, or a sequence of malformed/fake glyphs intended to resemble writing.",
                "Inspect foreground and background, especially screens, posters, colored panels, packaging, walls, clothing, and the bottom and right edges.",
                "Even misspelled, cropped, blurry, nonsensical, or partially occluded writing counts as TEXT_PRESENT.",
                "Return TEXT_FREE only when there are no writing-like character sequences anywhere. Answer exactly TEXT_PRESENT or TEXT_FREE."
              ].join(" ")
            },
            { type: "image_url", image_url: { url: `data:image/png;base64,${body.toString("base64")}`, detail: "high" } }
          ]
        }]
      } as never);
      const verdict = response.choices[0]?.message?.content?.toUpperCase() ?? "";
      if (verdict.includes("TEXT_PRESENT")) return true;
      if (verdict.includes("TEXT_FREE")) return false;
      throw new Error("Vision model returned an inconclusive dedicated text inspection");
    }
    throw new Error("No vision service is configured for dedicated text inspection");
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

function sameLockedStyle(left: Scene, right: Scene) {
  if (left.style.visualStyleId || right.style.visualStyleId) {
    return left.style.visualStyleId === right.style.visualStyleId;
  }
  return left.style.visualStylePrompt?.trim() === right.style.visualStylePrompt?.trim();
}

async function loadProjectStyleAnchorReference(project: Project, scene: Scene) {
  const lockedStyle = projectLockedVisualStyle(project);
  if (!lockedStyle || lockedStyle.visualStyleId === "cinematic-realism") return undefined;
  const anchorScene = project.currentVersion.scenes
    .filter((candidate) => candidate.sceneNumber !== scene.sceneNumber && sameLockedStyle(candidate, scene))
    .sort((left, right) => left.sceneNumber - right.sceneNumber)
    .find((candidate) => candidate.assets.some((asset) => (
      asset.type === "image"
      && asset.metadata?.source === "generated-image"
      && asset.url
      && asset.r2Key
    )));
  const anchorAsset = anchorScene?.assets.find((asset) => (
    asset.type === "image"
    && asset.metadata?.source === "generated-image"
    && asset.url
    && asset.r2Key
  ));
  return loadImageReference(anchorAsset, "style-anchor");
}

async function loadProjectComparisonImages(project: Project, scene: Scene) {
  const comparisonScenes = project.currentVersion.scenes
    .filter((candidate) => candidate.sceneNumber !== scene.sceneNumber && sameLockedStyle(candidate, scene))
    .sort((left, right) => {
      const leftDistance = Math.abs(left.sceneNumber - scene.sceneNumber);
      const rightDistance = Math.abs(right.sceneNumber - scene.sceneNumber);
      return leftDistance - rightDistance || left.sceneNumber - right.sceneNumber;
    })
    .slice(0, 4);
  const comparisons = await Promise.all(comparisonScenes.map(async (candidate) => {
    const acceptedGeneratedImage = candidate.assets.find((asset) => (
      asset.type === "image"
      && asset.metadata?.source === "generated-image"
      && asset.url
      && asset.r2Key
    ));
    const reference = await loadImageReference(acceptedGeneratedImage, "style-anchor");
    return reference ? { body: reference.body, sceneNumber: candidate.sceneNumber } : undefined;
  }));
  return comparisons.filter(Boolean) as SceneComparisonImage[];
}

async function nearestSceneSimilarity(body: Buffer, comparisons: SceneComparisonImage[]) {
  let nearest: { score: number; sceneNumber: number } | undefined;
  for (const comparison of comparisons) {
    const score = await imagePerceptualSimilarity(body, comparison.body);
    if (!nearest || score > nearest.score) nearest = { score, sceneNumber: comparison.sceneNumber };
  }
  return nearest;
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
  visualInstruction?: string,
  comparisonImages: SceneComparisonImage[] = []
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
  let fallbackCandidate: TextFreeImageCandidate | undefined;
  let qualityWarningCode: RecoverableImageQualityCode | undefined;
  let closestScene: { score: number; sceneNumber: number } | undefined;
  let duplicateWasDetected = false;
  for (let qualityAttempt = 0; qualityAttempt < 3; qualityAttempt += 1) {
    seed = (baseSeed + qualityAttempt * 104_729) % 2_147_483_647 || 1;
    const duplicateCorrection = duplicateWasDetected
      ? "COMPOSITION REJECTION: the prior candidate was too similar to another scene. Re-stage this beat from a substantially different camera height, shot size, subject arrangement, foreground silhouette, and background. Do not reuse the same tabletop, centered object group, horizon, pose, or color-block placement."
      : "";
    const attemptPrompt = qualityAttempt === 2
      ? `${buildTextSafeCorrectionPrompt(scene, project)}\n${duplicateCorrection}`
      : enforceTextFreeImagePrompt(qualityAttempt === 0
        ? prompt
        : `${prompt}\n${duplicateCorrection}\nQuality correction attempt ${qualityAttempt + 1}: the prior candidate was rejected. Rebuild the composition as a fully resolved, information-rich frame in the exact locked rendering medium. The actual scene subject, action, environment, and narrative cause-and-effect must be immediately recognizable; a palette sheet, pattern, material sample, abstract shapes, or style demonstration is invalid. Remove every word, letter, number, logo, watermark, fake glyph, and writing-like mark; use blank surfaces and purely pictorial objects instead. Keep clear subject separation and meaningful foreground, midground, and background. Do not switch to photography, 3D, voxel, low-poly, or another illustration style. Avoid empty gradients or featureless surfaces.`);
    const attemptReferences = duplicateWasDetected
      ? usableReferences.filter((reference) => reference.role !== "style-anchor")
      : usableReferences;
    let generatedBody: Buffer;
    let generatedModel: string;
    let effectivePrompt = attemptPrompt;
    try {
      if (hasCloudflareAI()) {
        let generated;
        try {
          generated = await generateCloudflareImage(attemptPrompt, effectiveQuality, {
            seed,
            references: attemptReferences
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
      // Text is a hard safety boundary. Semantic/style inspection is kept
      // separate so a conservative quality verdict cannot erase a usable frame.
      const containsText = await generatedImageContainsAnyText(normalized.body);
      if (containsText) {
        throw new GeneratedImageQualityError("生成画面包含文字或类似文字的符号。", "text_detected");
      }

      const nearest = await nearestSceneSimilarity(normalized.body, comparisonImages);
      if (nearest && nearest.score >= ADJACENT_SCENE_DUPLICATE_THRESHOLD) {
        duplicateWasDetected = true;
        closestScene = nearest;
        throw new GeneratedImageQualityError(
          `生成画面与分镜 ${nearest.sceneNumber} 的构图过于相似。`,
          "composition_duplicate"
        );
      }
      if (!closestScene || (nearest && nearest.score > closestScene.score)) closestScene = nearest;

      let inspection: Awaited<ReturnType<typeof inspectGeneratedImage>>;
      try {
        inspection = await inspectGeneratedImage(normalized.body, scene, project);
      } catch (error) {
        if (!(error instanceof GeneratedImageQualityError) || error.code !== "semantic_check_failed") throw error;
        fallbackCandidate = betterTextFreeCandidate(fallbackCandidate, {
          body: normalized.body,
          metadata: normalized.metadata,
          model: generatedModel,
          prompt: effectivePrompt,
          seed,
          warningCode: error.code
        });
        if (qualityAttempt < 2) {
          console.warn(`[image-assets] Scene ${scene.sceneNumber} inspection was unavailable; retrying with a new candidate.`);
          continue;
        }
        break;
      }
      if (inspection === "text_present") {
        throw new GeneratedImageQualityError("生成画面包含文字或类似文字的符号。", "text_detected");
      }
      if (inspection === "semantic_mismatch" || inspection === "style_mismatch") {
        const qualityError = inspection === "semantic_mismatch"
          ? new GeneratedImageQualityError("生成画面与当前场景内容不匹配。", "semantic_mismatch")
          : new GeneratedImageQualityError("生成画面偏离项目锁定的视觉风格。", "style_mismatch");
        fallbackCandidate = betterTextFreeCandidate(fallbackCandidate, {
          body: normalized.body,
          metadata: normalized.metadata,
          model: generatedModel,
          prompt: effectivePrompt,
          seed,
          warningCode: inspection
        });
        if (qualityAttempt < 2) {
          console.warn(`[image-assets] Scene ${scene.sceneNumber} image failed quality validation (${qualityError.code}); retrying:`, qualityError.message);
          continue;
        }
        break;
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
  if (!body && fallbackCandidate) {
    body = fallbackCandidate.body;
    qualityMetadata = fallbackCandidate.metadata;
    model = fallbackCandidate.model;
    prompt = fallbackCandidate.prompt;
    seed = fallbackCandidate.seed;
    qualityWarningCode = fallbackCandidate.warningCode;
    console.warn(
      `[image-assets] Scene ${scene.sceneNumber} kept the best text-free candidate after quality retries (${qualityWarningCode}).`
    );
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
      closestSceneNumber: closestScene?.sceneNumber,
      closestSceneSimilarity: closestScene?.score,
      candidateInstruction: visualInstruction || undefined,
      qualityWarningCode,
      qualityFallback: Boolean(qualityWarningCode),
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
  const targets = [...selectedIndexes];

  // Generate project scenes in order so every later scene can be compared with
  // the actual accepted frames before it. Parallel generation cannot enforce
  // cross-scene composition uniqueness reliably.
  await mapWithConcurrency(targets, 1, async ({ scene, index }) => {
      try {
        const workingProject = {
          ...project,
          currentVersion: { ...project.currentVersion, scenes }
        };
        const currentReference = await loadSceneImageReference(scene, "current");
        const styleAnchorReference = await loadProjectStyleAnchorReference(workingProject, scene);
        const comparisonImages = await loadProjectComparisonImages(workingProject, scene);
        const references = [currentReference, styleAnchorReference].filter(Boolean) as ImageReference[];
        const generated = await generateSceneImage(
          scene,
          workingProject,
          options.quality ?? "standard",
          references,
          options.variantKey,
          options.visualInstruction,
          comparisonImages
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
