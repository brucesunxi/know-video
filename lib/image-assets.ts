import OpenAI from "openai";
import sharp from "sharp";
import {
  detectCloudflareImageText,
  evaluateCloudflareImageComposition,
  evaluateCloudflareImageSemantics,
  evaluateCloudflareImageStyle,
  generateCloudflareImage,
  hasCloudflareAI,
  inspectCloudflareGeneratedImage
} from "@/lib/cloudflare-ai";
import { sceneReferenceAssets } from "@/lib/attachment-context";
import { getOptionalEnv } from "@/lib/env";
import {
  enforceTextFreeImagePrompt,
  imageSafeSemanticText,
  projectLockedVisualStyle,
  projectVisualIdentity,
  sceneRequiresPremiumImage,
  sceneImagePrompt,
  sceneVisualDiversityDirection,
  stableImageSeed,
  type ImageReferenceRole
} from "@/lib/image-continuity";
import {
  GeneratedImageQualityError,
  normalizeGeneratedImage,
  type GeneratedImageQualityErrorCode
} from "@/lib/image-quality";
import {
  ADJACENT_SCENE_DUPLICATE_THRESHOLD,
  imagePerceptualSimilarity,
  POSSIBLE_SCENE_DUPLICATE_THRESHOLD
} from "@/lib/image-similarity";
import { mediaAssetStatus } from "@/lib/generation-resume";
import { assetUrlForKey, getFromR2, uploadToR2 } from "@/lib/r2";
import type { Project, Scene, SceneAsset } from "@/lib/types";
import { exactVisualStyleDirection } from "@/lib/visual-style-profiles";
import { billingCatalogItem } from "@/lib/billing/catalog";
import { recordProviderCostAttempt } from "@/lib/billing/provider-costs";
import {
  imageCompletionFallbackScore,
  shouldUseImageCompletionFallback,
  type ImageCompletionFallbackReason
} from "@/lib/image-completion-policy";

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
    "Create a brand-safe 16:9 cinematic key visual for one natural commercial-film scene.",
    projectVisualIdentity(project),
    exactVisualStyleDirection(projectLockedVisualStyle(project) ?? scene.style),
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
    exactVisualStyleDirection(projectLockedVisualStyle(project) ?? scene.style),
    `Meaning to visualize: ${imageSafeSemanticText(scene.voiceover)}.`,
    semanticFallbackComposition(scene),
    `Mood: ${scene.style.mood}. Palette: ${scene.style.palette.join(", ")}.`,
    "Use safe scene-specific learning objects, product props, paths and environment details, all rendered only in the locked style above.",
    "No recognizable brands, logos, readable text, real minors, faces, copyrighted characters, weapons, harm, conflict, or sensitive content."
  ].join("\n"));
}

function textSafePhysicalObjectDirection(scene: Scene) {
  const description = `${scene.title}\n${scene.voiceover}\n${scene.visualPrompt}`;
  if (/(?:图书馆|书店|阅览|阅读|书架|借阅|还书|library|bookstore|reading|bookshelf|borrowing books|returning books)/iu.test(description)) {
    return [
      "LIBRARY TEXT-SAFE OBJECT RULE: books, shelves, and reading furniture are required semantic objects and must remain visible.",
      "Render every book cover and spine as a completely plain unmarked color or material surface. Remove titles, labels, numbers, barcodes, decorative line clusters, and writing-like marks while preserving recognizable book shapes and shelf depth."
    ].join("\n");
  }
  return [
    "Keep every physical object that is essential to the scene's subject, action, and setting.",
    "Avoid front-facing written surfaces when they are not essential. When an essential object normally carries writing, turn that surface away from camera or render it as one clean, completely blank material or color area without glyph-like decoration."
  ].join("\n");
}

function correctionReferenceDirection(references: ImageReference[]) {
  const styleAnchorCount = references.filter((reference) => reference.role === "style-anchor").length;
  const hasCurrentReference = references.some((reference) => reference.role === "current");
  return [
    styleAnchorCount > 0
      ? `The ${styleAnchorCount} attached project frame${styleAnchorCount === 1 ? " is a" : "s are"} STYLE-ONLY anchor${styleAnchorCount === 1 ? "" : "s"}. Match their shared rendering medium, line treatment, texture, palette behavior, and lighting, but copy none of their subjects, objects, camera angles, poses, foreground silhouettes, or layouts.`
      : "",
    hasCurrentReference
      ? "The attached current-scene reference may preserve subject identity, but the corrected frame must still obey this scene's distinct camera blueprint."
      : ""
  ].filter(Boolean).join("\n");
}

function buildTextSafeCorrectionPrompt(scene: Scene, project: Project, references: ImageReference[]) {
  return enforceTextFreeImagePrompt([
    "Create a polished, completely text-free 16:9 scene illustration.",
    projectVisualIdentity(project),
    exactVisualStyleDirection(projectLockedVisualStyle(project) ?? scene.style),
    correctionReferenceDirection(references),
    `Scene meaning: ${imageSafeSemanticText(scene.voiceover)} ${imageSafeSemanticText(scene.visualPrompt)}`,
    semanticFallbackComposition(scene),
    sceneVisualDiversityDirection(scene, project.currentVersion.scenes.length),
    `Mood: ${scene.style.mood}. Palette: ${scene.style.palette.join(", ")}.`,
    "Build the meaning with recognizable people, environments, actions, and physical objects instead of written information.",
    textSafePhysicalObjectDirection(scene),
    "TEXT-SAFE COMPOSITION: do not include front-facing screens, phones, signs, posters, whiteboards, blackboards, dashboards, charts, forms, labels, badges, storefront lettering, vehicle markings, or decorative glyphs. Necessary physical objects may remain only with completely blank written surfaces.",
    "Use natural scene depth and a single clear action. Keep all surfaces plain and uninterrupted. Do not arrange blank rectangles or lines in a way that resembles an interface, document, chart, or writing.",
    "The final frame must remain rich and specific to this scene while containing no typography or writing-like marks."
  ].join("\n"));
}

function semanticFallbackComposition(scene: Scene) {
  const description = `${scene.title}\n${scene.voiceover}\n${scene.visualPrompt}`;
  if (/(?:图书馆|书店|阅览|阅读|书架|借阅|还书|library|bookstore|reading|bookshelf|borrowing books|returning books)/iu.test(description)) {
    const beats = [
      "a deep entrance view introducing the library with an off-center reader and layered aisles",
      "a side-angle reader selecting a single book from a shelf framed by a different foreground bay",
      "a high three-quarter reading-table detail with hands, open blank pages, and distant shelves",
      "an over-the-shoulder borrowing, returning, guidance, or quiet study interaction away from the entrance",
      "an asymmetrical closing view from inside a deep aisle or reading area, seen from behind a reader with a clear path forward"
    ];
    const beat = beats[Math.min(beats.length - 1, Math.max(0, scene.sceneNumber - 1) % beats.length)];
    return `Composition: ${beat}. Keep books and shelves recognizable, but make every cover and spine completely plain and unmarked with no title-like decoration.`;
  }
  if (/(?:方块|沙盒|游戏|课程|编程|voxel|sandbox|game|course|programming)/iu.test(description)) {
    return "Composition: a different voxel-learning beat for this scene, such as a planning desk with unlabeled colored blocks, an abstract block-building workspace, a simple logic circuit made of cubes and light paths, or a finished voxel world display with no characters or logos.";
  }
  if (/(?:库存|仓库|物流|订单|跨境|inventory|warehouse|logistics|order)/iu.test(description)) {
    return "Composition: a clear abstract operations map with warehouse nodes, parcels, route lines, inventory groups, and cause-and-effect flow, all unlabeled.";
  }
  return "Composition: a scene-specific metaphor with a distinct foreground object, middle-ground action, and background environment that matches the narration.";
}

function qualityRecoveryDirection(
  code: GeneratedImageQualityErrorCode | undefined,
  scene: Scene,
  project: Project
) {
  if (!code) return "";
  const lockedStyle = projectLockedVisualStyle(project) ?? scene.style;
  const exactStyle = exactVisualStyleDirection(lockedStyle) || `${lockedStyle.theme}; ${lockedStyle.mood}`;
  if (code === "style_mismatch") {
    return [
      "STYLE REJECTION: the previous candidate used the wrong visible rendering medium.",
      `Rebuild every visible element in this exact locked style: ${exactStyle}`,
      "Do not preserve the rejected candidate's photographic-versus-illustrated nature, dimensionality, line treatment, texture, or material treatment when any of those conflict with the locked style."
    ].join("\n");
  }
  if (code === "composition_duplicate") {
    return [
      "COMPOSITION REJECTION: the previous candidate repeated another scene's shot concept.",
      sceneVisualDiversityDirection(scene, project.currentVersion.scenes.length),
      "Keep recurring identity only. Replace the pose, action, camera side, camera height, shot size, foreground silhouette, tabletop or room layout, and background arrangement."
    ].join("\n");
  }
  if (code === "semantic_mismatch" || code === "semantic_check_failed") {
    return [
      "CONTENT REJECTION: the previous candidate did not clearly communicate this scene's actual narrative beat.",
      `Required visible meaning: ${imageSafeSemanticText(scene.voiceover)} ${imageSafeSemanticText(scene.visualPrompt)}`,
      "Use a concrete subject, purposeful action, recognizable environment, and visible cause-and-effect instead of a generic portrait, style sample, or decorative scene."
    ].join("\n");
  }
  if (code === "text_detected" || code === "text_check_failed") {
    return "TEXT REJECTION: remove every written or writing-like mark and redesign written surfaces as plain, completely blank physical materials.";
  }
  return "QUALITY REJECTION: rebuild the frame from a substantially different composition while preserving the required subject, action, and exact locked style.";
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

type GeneratedImageCandidate = {
  body: Buffer;
  metadata: Awaited<ReturnType<typeof normalizeGeneratedImage>>["metadata"];
  model: string;
  prompt: string;
  seed: number;
};

type TextFreeImageCandidate = GeneratedImageCandidate & {
  textFreeVerified: true;
};

const MAX_IMAGE_QUALITY_ATTEMPTS = 4;

function expectedSceneSemantics(scene: Scene, project: Project) {
  const lockedStyle = projectLockedVisualStyle(project) ?? scene.style;
  return [
    `Project subject: ${imageSafeSemanticText(project.title)}.`,
    `LOCKED VISUAL STYLE: ${exactVisualStyleDirection(lockedStyle) || `${lockedStyle.theme}; ${lockedStyle.mood}`}.`,
    `Scene ${scene.sceneNumber}: ${imageSafeSemanticText(scene.title)}.`,
    `Narrative meaning: ${imageSafeSemanticText(scene.voiceover)}.`,
    `Required visible content: ${imageSafeSemanticText(scene.visualPrompt)}.`,
    sceneVisualDiversityDirection(scene, project.currentVersion.scenes.length)
  ].join("\n").slice(0, 3600);
}

function essentialSceneSemantics(scene: Scene, project: Project) {
  return [
    `Project topic: ${imageSafeSemanticText(project.title)}.`,
    `Scene ${scene.sceneNumber}: ${imageSafeSemanticText(scene.title)}.`,
    `Essential visible meaning: ${imageSafeSemanticText(scene.voiceover)}.`,
    semanticFallbackComposition(scene),
    "Accept a concrete, recognizable visual interpretation of this beat even if it does not literally depict every descriptive phrase."
  ].join("\n").slice(0, 2400);
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
              "Otherwise return SEMANTIC_MISMATCH if the central subject, action, and setting are unrelated or unrecognizable, or the image is a palette, pattern sheet, material swatch, decorative geometry, generic background, split-screen montage, contact sheet, storyboard sheet, style sample, browser window, website screenshot, application interface, dashboard, presentation slide, document, or mostly blank screen.",
              "A browser or app screenshot is never an acceptable substitute for a concrete film scene, even when the topic mentions software, a website, onboarding, or a welcome page.",
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
    const inspectionBody = await buildTextInspectionSheet(body);
    // Keep image generation and validation on Cloudflare when it is configured.
    // Falling through to OpenAI here can reject otherwise valid Cloudflare output
    // because of an unrelated OpenAI quota or billing issue.
    if (hasCloudflareAI()) return (await detectCloudflareImageText(inspectionBody)).hasText;
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
            { type: "image_url", image_url: { url: `data:image/png;base64,${inspectionBody.toString("base64")}`, detail: "high" } }
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

async function buildTextInspectionSheet(body: Buffer) {
  const source = sharp(body).rotate();
  const metadata = await source.metadata();
  const width = metadata.width ?? 1280;
  const height = metadata.height ?? 720;
  const cropWidth = Math.max(1, Math.round(width * 0.72));
  const cropHeight = Math.max(1, Math.round(height * 0.72));
  const left = Math.max(0, Math.round((width - cropWidth) / 2));
  const topPositions = [
    0,
    Math.max(0, Math.round((height - cropHeight) / 2)),
    Math.max(0, height - cropHeight)
  ];
  const tile = (input: sharp.Sharp) => input
    .resize(640, 360, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
  const [full, upper, center, lower] = await Promise.all([
    tile(sharp(body).rotate()),
    tile(sharp(body).rotate().extract({ left, top: topPositions[0], width: cropWidth, height: cropHeight })),
    tile(sharp(body).rotate().extract({ left, top: topPositions[1], width: cropWidth, height: cropHeight })),
    tile(sharp(body).rotate().extract({ left, top: topPositions[2], width: cropWidth, height: cropHeight }))
  ]);
  return sharp({
    create: { width: 1280, height: 720, channels: 3, background: "#808080" }
  }).composite([
    { input: full, left: 0, top: 0 },
    { input: upper, left: 640, top: 0 },
    { input: center, left: 0, top: 360 },
    { input: lower, left: 640, top: 360 }
  ]).png().toBuffer();
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

const TRUSTED_STYLE_ANCHOR_GATES = new Set([
  "strict-semantic-style-pass",
  "independent-semantic-style-recovery"
]);

function isTrustedStyleAnchorAsset(asset: SceneAsset) {
  return asset.type === "image"
    && asset.metadata?.source === "generated-image"
    && asset.metadata?.textFreeVerified === true
    && TRUSTED_STYLE_ANCHOR_GATES.has(String(asset.metadata?.qualityGate ?? ""))
    && Boolean(asset.url && asset.r2Key);
}

async function loadProjectStyleAnchorReferences(project: Project, scene: Scene) {
  const lockedStyle = projectLockedVisualStyle(project);
  if (!lockedStyle || lockedStyle.visualStyleId === "cinematic-realism") return [];
  const anchorScenes = project.currentVersion.scenes
    .filter((candidate) => candidate.sceneNumber !== scene.sceneNumber && sameLockedStyle(candidate, scene))
    .filter((candidate) => candidate.assets.some(isTrustedStyleAnchorAsset))
    .sort((left, right) => left.sceneNumber - right.sceneNumber);
  if (anchorScenes.length === 0) return [];

  // One canonical, strictly approved frame is a clearer style authority than a
  // collection that may drift scene by scene. Composition is varied by prompt
  // and checked separately below.
  const anchorAsset = anchorScenes[0].assets.find(isTrustedStyleAnchorAsset);
  const reference = await loadImageReference(anchorAsset, "style-anchor");
  return reference ? [reference] : [];
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
  let nearest: { score: number; sceneNumber: number; body: Buffer } | undefined;
  for (const comparison of comparisons) {
    const score = await imagePerceptualSimilarity(body, comparison.body);
    if (!nearest || score > nearest.score) nearest = { score, sceneNumber: comparison.sceneNumber, body: comparison.body };
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
  comparisonImages: SceneComparisonImage[] = [],
  allowCompletionFallback = false,
  maxQualityAttempts = MAX_IMAGE_QUALITY_ATTEMPTS
): Promise<{ asset: SceneAsset } | undefined> {
  const effectiveQuality: ImageQuality = quality === "premium" || sceneRequiresPremiumImage(scene)
    ? "premium"
    : "standard";
  const usableReferences = hasCloudflareAI() ? references : [];
  const baseSeed = stableImageSeed(`${project.id}:${scene.sceneNumber}:${effectiveQuality}:${variantKey}`);
  const qualityAttemptLimit = Math.max(1, Math.min(MAX_IMAGE_QUALITY_ATTEMPTS, maxQualityAttempts));
  let prompt = buildSceneImagePrompt(scene, project, usableReferences, visualInstruction);
  let body: Buffer | undefined;
  let model = "";
  let seed = baseSeed;
  let qualityMetadata: Awaited<ReturnType<typeof normalizeGeneratedImage>>["metadata"] | undefined;
  let closestScene: { score: number; sceneNumber: number } | undefined;
  let duplicateWasDetected = false;
  let completionFallback: TextFreeImageCandidate & {
    score: number;
    reason: ImageCompletionFallbackReason;
  } | undefined;
  let lastQualityRejection: GeneratedImageQualityErrorCode | undefined;
  let lastQualityError: GeneratedImageQualityError | undefined;
  let textFreeVerified = false;
  let usedIndependentRecovery = false;
  let completionFallbackReason: ImageCompletionFallbackReason | undefined;
  let providerRequestCount = 0;
  let validationRequestCount = 0;
  const canonicalStyleAnchorKey = usableReferences.find((reference) => reference.role === "style-anchor")?.r2Key;
  const costRunId = crypto.randomUUID();
  const rememberCompletionFallback = (
    candidate: Omit<NonNullable<typeof completionFallback>, "score" | "reason">,
    reason: ImageCompletionFallbackReason
  ) => {
    if (!allowCompletionFallback) return;
    const score = imageCompletionFallbackScore(reason);
    if (shouldUseImageCompletionFallback(completionFallback, { ...candidate, score })) {
      completionFallback = { ...candidate, score, reason };
    }
  };
  const trackedCloudflareImage = async (
    imagePrompt: string,
    imageOptions: Parameters<typeof generateCloudflareImage>[2],
    requestLabel: string
  ) => {
    providerRequestCount += 1;
    let outcome: "succeeded" | "failed" = "failed";
    let actualModel = billingCatalogItem(effectiveQuality === "premium" ? "image_premium" : "image_standard").model;
    try {
      const result = await generateCloudflareImage(imagePrompt, effectiveQuality, imageOptions);
      actualModel = result.model;
      outcome = "succeeded";
      return result;
    } finally {
      await recordProviderCostAttempt({
        projectId: project.id,
        versionId: project.currentVersion.id,
        sceneNumber: scene.sceneNumber,
        provider: "cloudflare",
        model: actualModel,
        operation: "image_generation",
        outcome,
        costUsd: billingCatalogItem(effectiveQuality === "premium" ? "image_premium" : "image_standard").estimatedProviderUsdPerUnit,
        idempotencyKey: `${costRunId}:image:${requestLabel}`,
        metadata: { effectiveQuality, variantKey }
      });
    }
  };
  const trackedValidation = async <T>(requestLabel: string, operation: () => Promise<T>) => {
    validationRequestCount += 1;
    let outcome: "succeeded" | "failed" = "failed";
    try {
      const result = await operation();
      outcome = "succeeded";
      return result;
    } finally {
      const vision = billingCatalogItem("vision_analysis");
      await recordProviderCostAttempt({
        projectId: project.id,
        versionId: project.currentVersion.id,
        sceneNumber: scene.sceneNumber,
        provider: vision.provider,
        model: vision.model,
        operation: "image_quality_validation",
        outcome,
        costUsd: vision.estimatedProviderUsdPerUnit,
        idempotencyKey: `${costRunId}:validation:${requestLabel}`,
        metadata: { effectiveQuality, variantKey }
      });
    }
  };
  for (let qualityAttempt = 0; qualityAttempt < qualityAttemptLimit; qualityAttempt += 1) {
    seed = (baseSeed + qualityAttempt * 104_729) % 2_147_483_647 || 1;
    const recoveryDirection = qualityRecoveryDirection(lastQualityRejection, scene, project);
    // Image references strongly influence both style and layout. After a
    // duplicate rejection, temporarily remove style-only anchors so the next
    // seed can genuinely re-stage the shot. A later style rejection restores
    // the canonical anchor automatically.
    const attemptReferences = lastQualityRejection === "composition_duplicate"
      ? usableReferences.filter((reference) => reference.role === "current")
      : usableReferences;
    const duplicateCorrection = duplicateWasDetected
      ? "COMPOSITION REJECTION: a prior candidate copied another scene too closely. Re-stage this beat from a substantially different camera height, shot size, camera side, subject action, foreground silhouette, and background. Do not reuse the same tabletop, centered object group, aisle view, horizon, pose, or color-block placement."
      : "";
    const attemptPrompt = qualityAttempt === qualityAttemptLimit - 1
      ? `${buildTextSafeCorrectionPrompt(scene, project, attemptReferences)}\n${recoveryDirection}\n${duplicateCorrection}`
      : enforceTextFreeImagePrompt(qualityAttempt === 0
        ? prompt
        : `${prompt}\n${recoveryDirection}\n${duplicateCorrection}\nQuality correction attempt ${qualityAttempt + 1}: the prior candidate was rejected. Rebuild the composition as a fully resolved, information-rich frame in the exact locked rendering medium. The actual scene subject, action, environment, and narrative cause-and-effect must be immediately recognizable; a palette sheet, pattern, material sample, abstract shapes, or style demonstration is invalid. Remove every word, letter, number, logo, watermark, fake glyph, and writing-like mark; use blank surfaces and purely pictorial objects instead. Keep clear subject separation and meaningful foreground, midground, and background. Avoid empty gradients or featureless surfaces.`);
    let generatedBody: Buffer;
    let generatedModel: string;
    let effectivePrompt = attemptPrompt;
    try {
      if (hasCloudflareAI()) {
        let generated;
        try {
          generated = await trackedCloudflareImage(attemptPrompt, {
            seed,
            references: attemptReferences
          }, `${qualityAttempt}:primary`);
        } catch (error) {
          if (!isSafetyFiltered(error)) throw error;
          effectivePrompt = buildBrandSafeImagePrompt(scene, project);
          try {
            generated = await trackedCloudflareImage(effectivePrompt, { seed }, `${qualityAttempt}:brand-safe`);
          } catch (fallbackError) {
            if (!isSafetyFiltered(fallbackError)) throw fallbackError;
            effectivePrompt = buildUltraSafeSceneImagePrompt(scene, project);
            generated = await trackedCloudflareImage(effectivePrompt, {
              seed: (seed + 7_919) % 2_147_483_647 || 1,
              guidance: 3
            }, `${qualityAttempt}:ultra-safe`);
          }
        }
        generatedBody = generated.body;
        generatedModel = generated.model;
      } else {
        const client = new OpenAI({ apiKey: getOptionalEnv("OPENAI_API_KEY") });
        providerRequestCount += 1;
        let openAiOutcome: "succeeded" | "failed" = "failed";
        let result: Awaited<ReturnType<typeof client.images.generate>>;
        try {
          result = await client.images.generate({
            model: imageModel(),
            prompt: attemptPrompt,
            size: "1536x1024",
            quality: "medium",
            n: 1
          } as never);
          openAiOutcome = "succeeded";
        } finally {
          await recordProviderCostAttempt({
            projectId: project.id,
            versionId: project.currentVersion.id,
            sceneNumber: scene.sceneNumber,
            provider: "openai",
            model: imageModel(),
            operation: "image_generation",
            outcome: openAiOutcome,
            costUsd: billingCatalogItem(effectiveQuality === "premium" ? "image_premium" : "image_standard").estimatedProviderUsdPerUnit,
            idempotencyKey: `${costRunId}:image:${qualityAttempt}:openai`,
            metadata: { effectiveQuality, variantKey, costSource: "catalog_estimate" }
          });
        }
        const image = result.data?.[0];
        const base64 = image ? (image as { b64_json?: string }).b64_json : undefined;
        if (!base64) return undefined;
        generatedBody = Buffer.from(base64, "base64");
        generatedModel = imageModel();
      }
      const normalized = await normalizeGeneratedImage(generatedBody);
      const normalizedCandidate = {
        body: normalized.body,
        metadata: normalized.metadata,
        model: generatedModel,
        prompt: effectivePrompt,
        seed
      };
      // Text is an absolute delivery boundary. An unverified candidate is never
      // retained, even during the premium completion-rescue pass.
      const containsText = hasCloudflareAI()
        ? await trackedValidation(`${qualityAttempt}:text`, () => generatedImageContainsAnyText(normalized.body))
        : await generatedImageContainsAnyText(normalized.body);
      if (containsText) {
        throw new GeneratedImageQualityError("生成画面包含文字或类似文字的符号。", "text_detected");
      }
      const textFreeCandidate: TextFreeImageCandidate = {
        ...normalizedCandidate,
        textFreeVerified: true
      };

      const nearest = await nearestSceneSimilarity(normalized.body, comparisonImages);
      let compositionDuplicate = Boolean(nearest && nearest.score >= ADJACENT_SCENE_DUPLICATE_THRESHOLD);
      if (
        nearest
        && !compositionDuplicate
        && nearest.score >= POSSIBLE_SCENE_DUPLICATE_THRESHOLD
        && hasCloudflareAI()
      ) {
        let compositionReview;
        try {
          compositionReview = await trackedValidation(
            `${qualityAttempt}:composition:${nearest.sceneNumber}`,
            () => evaluateCloudflareImageComposition(normalized.body, nearest.body)
          );
        } catch (error) {
          throw new GeneratedImageQualityError("无法确认生成画面与其他分镜的构图差异。", "semantic_check_failed", { cause: error });
        }
        compositionDuplicate = !compositionReview.distinct;
      }
      if (nearest && compositionDuplicate) {
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
        inspection = hasCloudflareAI()
          ? await trackedValidation(`${qualityAttempt}:semantic`, () => inspectGeneratedImage(normalized.body, scene, project))
          : await inspectGeneratedImage(normalized.body, scene, project);
      } catch (error) {
        if (!(error instanceof GeneratedImageQualityError) || error.code !== "semantic_check_failed") throw error;
        rememberCompletionFallback(textFreeCandidate, "semantic_check_failed");
        throw error;
      }
      if (inspection === "text_present") {
        // A positive signal from either detector rejects the candidate. The
        // completion fallback must never overrule this disagreement.
        throw new GeneratedImageQualityError("生成画面包含文字或类似文字的符号。", "text_detected");
      }
      if (inspection === "semantic_mismatch" || inspection === "style_mismatch") {
        const qualityError = inspection === "semantic_mismatch"
          ? new GeneratedImageQualityError("生成画面与当前场景内容不匹配。", "semantic_mismatch")
          : new GeneratedImageQualityError("生成画面偏离项目锁定的视觉风格。", "style_mismatch");
        rememberCompletionFallback(
          textFreeCandidate,
          inspection === "style_mismatch" ? "style_mismatch" : "semantic_mismatch"
        );
        throw qualityError;
      }
      body = normalized.body;
      qualityMetadata = normalized.metadata;
      model = generatedModel;
      prompt = effectivePrompt;
      textFreeVerified = true;
      break;
    } catch (error) {
      if (!(error instanceof GeneratedImageQualityError)) {
        if (allowCompletionFallback && completionFallback) {
          console.warn(`[image-assets] Scene ${scene.sceneNumber} provider retry failed after a recoverable candidate was retained; independently verifying it.`, error);
          break;
        }
        throw error;
      }
      lastQualityRejection = error.code;
      lastQualityError = error;
      if (qualityAttempt === qualityAttemptLimit - 1) {
        if (allowCompletionFallback && completionFallback) break;
        throw error;
      }
      console.warn(`[image-assets] Scene ${scene.sceneNumber} image failed quality validation (${error.code}); retrying:`, error.message);
    }
  }
  if ((!body || !qualityMetadata) && allowCompletionFallback && completionFallback && hasCloudflareAI()) {
    const retainedCandidate = completionFallback;
    const lockedStyle = projectLockedVisualStyle(project) ?? scene.style;
    const expectedStyle = exactVisualStyleDirection(lockedStyle) || `${lockedStyle.theme}; ${lockedStyle.mood}`;
    try {
      // A rejected candidate is never delivered merely because it is the best
      // available one. It must pass two focused, independent checks after the
      // text and cross-scene composition gates have already passed.
      const [semanticCheck, styleCheck] = await Promise.all([
        trackedValidation(
          `recovery:${retainedCandidate.reason}:semantic`,
          () => evaluateCloudflareImageSemantics(retainedCandidate.body, essentialSceneSemantics(scene, project))
        ),
        trackedValidation(
          `recovery:${retainedCandidate.reason}:style`,
          () => evaluateCloudflareImageStyle(retainedCandidate.body, expectedStyle)
        )
      ]);
      if (semanticCheck.matches && styleCheck.matches) {
        body = retainedCandidate.body;
        qualityMetadata = retainedCandidate.metadata;
        model = retainedCandidate.model;
        prompt = retainedCandidate.prompt;
        seed = retainedCandidate.seed;
        usedIndependentRecovery = true;
        textFreeVerified = retainedCandidate.textFreeVerified;
        completionFallbackReason = retainedCandidate.reason;
        console.warn(`[image-assets] Scene ${scene.sceneNumber} accepted a retained candidate only after independent semantic and style verification (${retainedCandidate.reason}).`);
      } else {
        console.warn(`[image-assets] Scene ${scene.sceneNumber} rejected the retained candidate after independent verification (semantic=${semanticCheck.matches}, style=${styleCheck.matches}).`);
      }
    } catch (error) {
      console.warn(`[image-assets] Scene ${scene.sceneNumber} retained-candidate verification was unavailable:`, error);
    }
  }
  if (!body || !qualityMetadata) {
    if (lastQualityError) throw lastQualityError;
    return undefined;
  }
  if (!textFreeVerified) {
    throw new GeneratedImageQualityError("生成画面未通过无文字验证。", "text_check_failed");
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
      quality: effectiveQuality,
      prompt,
      seed,
      ...qualityMetadata,
      textFreeVerified: true,
      referenceKeys: usableReferences.map((reference) => reference.r2Key),
      canonicalStyleAnchorKey,
      closestSceneNumber: closestScene?.sceneNumber,
      closestSceneSimilarity: closestScene?.score,
      compositionReviewThreshold: POSSIBLE_SCENE_DUPLICATE_THRESHOLD,
      candidateInstruction: visualInstruction || undefined,
      qualityGate: usedIndependentRecovery
        ? "independent-semantic-style-recovery"
        : "strict-semantic-style-pass",
      completionFallbackReason,
      providerRequestCount,
      validationRequestCount,
      estimatedActualCostUsd: Number((
        providerRequestCount * billingCatalogItem(effectiveQuality === "premium" ? "image_premium" : "image_standard").estimatedProviderUsdPerUnit
        + validationRequestCount * billingCatalogItem("vision_analysis").estimatedProviderUsdPerUnit
      ).toFixed(6)),
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
    allowCompletionFallback?: boolean;
    maxQualityAttempts?: number;
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
        const styleAnchorReferences = await loadProjectStyleAnchorReferences(workingProject, scene);
        const comparisonImages = await loadProjectComparisonImages(workingProject, scene);
        const references = [currentReference, ...styleAnchorReferences].filter(Boolean) as ImageReference[];
        const generated = await generateSceneImage(
          scene,
          workingProject,
          options.quality ?? "standard",
          references,
          options.variantKey,
          options.visualInstruction,
          comparisonImages,
          options.allowCompletionFallback,
          options.maxQualityAttempts
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
