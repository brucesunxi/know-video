import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync(new URL("../app/api/assets/generate/route.ts", import.meta.url), "utf8");
const imageAssets = fs.readFileSync(new URL("../lib/image-assets.ts", import.meta.url), "utf8");
const continuity = fs.readFileSync(new URL("../lib/image-continuity.ts", import.meta.url), "utf8");
const cloudflare = fs.readFileSync(new URL("../lib/cloudflare-ai.ts", import.meta.url), "utf8");
const stockGuides = fs.readFileSync(new URL("../lib/stock-image-guides.ts", import.meta.url), "utf8");
const providerCosts = fs.readFileSync(new URL("../lib/billing/provider-costs.ts", import.meta.url), "utf8");

assert.match(route, /function imageFailedScenes/);
assert.match(route, /MAX_SCENES_PER_IMAGE_REQUEST = 1/);
assert.match(route, /processingSceneNumbers = requestedSceneNumbers\.slice\(0, MAX_SCENES_PER_IMAGE_REQUEST\)/);
assert.match(route, /requestedSceneNumbers/);
assert.match(route, /variantKey: body\.variantKey/);
assert.match(route, /persistGeneratedSceneAssets/);
assert.match(route, /sceneNumbers: processingSceneNumbers/);
assert.match(route, /mediaGenerationProgress\(\s*processingSceneNumbers,/);
assert.match(imageAssets, /inspectGeneratedImage/);
assert.match(imageAssets, /inspectCloudflareGeneratedImage/);
assert.match(imageAssets, /generatedImageContainsAnyText/);
assert.match(imageAssets, /buildTextInspectionSheet/);
assert.match(imageAssets, /const \[full, upper, center, lower\]/);
assert.match(imageAssets, /detectCloudflareImageText\(inspectionBody, visionDeadlineOptions\(deadlineMs\)\)/);
const textInspection = imageAssets.slice(
  imageAssets.indexOf("async function generatedImageContainsAnyText"),
  imageAssets.indexOf("async function loadImageReference")
);
assert.ok(
  textInspection.indexOf("hasCloudflareAI()") < textInspection.indexOf("OPENAI_API_KEY"),
  "Cloudflare text inspection must run before the optional OpenAI fallback"
);
assert.ok(
  imageAssets.indexOf("generatedImageContainsAnyText(normalized.body, deadlineMs)")
    < imageAssets.indexOf("inspectGeneratedImage(normalized.body, scene, project, deadlineMs)"),
  "Text rejection must remain a hard gate before recoverable semantic/style inspection"
);
assert.match(imageAssets, /misspelled, cropped, blurry, nonsensical/);
assert.match(imageAssets, /Do not return a palette, pattern, material sample, style demonstration, or generic background/);
assert.match(imageAssets, /qualityAttempt < qualityAttemptLimit/);
assert.match(imageAssets, /!isDefinitiveGeneratedImageQualityRejection\(error\)\) throw error/);
assert.match(imageAssets, /qualityAttempt === qualityAttemptLimit - 1/);
assert.match(imageAssets, /TEXT-SAFE COMPOSITION/);
assert.match(imageAssets, /生成画面包含文字或类似文字的符号/);
assert.match(imageAssets, /生成画面与当前场景内容不匹配/);
assert.match(imageAssets, /生成画面偏离项目锁定的视觉风格/);
assert.match(imageAssets, /STYLE_MISMATCH/);
assert.match(imageAssets, /MAX_IMAGE_QUALITY_ATTEMPTS = 4/);
assert.match(imageAssets, /allowCompletionFallback = false/);
assert.match(imageAssets, /evaluateCloudflareImageSemantics/);
assert.match(imageAssets, /evaluateCloudflareImageStyle/);
assert.match(imageAssets, /evaluateCloudflareImageComposition/);
assert.match(imageAssets, /independent-semantic-style-recovery/);
assert.match(imageAssets, /semanticCheck\.matches && styleCheck\.matches/);
assert.match(imageAssets, /independentlyVerifyCandidate/);
assert.match(imageAssets, /acceptCandidate\(textFreeCandidate, recoveryReason\)/);
assert.doesNotMatch(imageAssets, /allowStyleFallback|styleFallback|text-free-semantic-pass-style-fallback/);
assert.doesNotMatch(imageAssets, /betterTextFreeCandidate/);
assert.match(imageAssets, /composition_duplicate/);
assert.match(imageAssets, /ADJACENT_SCENE_DUPLICATE_THRESHOLD/);
assert.match(imageAssets, /POSSIBLE_SCENE_DUPLICATE_THRESHOLD/);
assert.match(imageAssets, /loadProjectStyleAnchorReferences/);
assert.match(imageAssets, /TRUSTED_STYLE_ANCHOR_GATES/);
assert.match(imageAssets, /const anchorAsset = anchorScenes\[0\]/);
assert.doesNotMatch(imageAssets, /const selected = \[nearest, contrasting\]/);
assert.match(imageAssets, /lastQualityRejection === "composition_duplicate"/);
assert.match(imageAssets, /usableReferences\.filter\(\(reference\) => reference\.role !== "style-anchor"\)/);
assert.match(imageAssets, /LIBRARY TEXT-SAFE OBJECT RULE/);
assert.match(imageAssets, /every book cover and spine as a completely plain unmarked/);
assert.doesNotMatch(imageAssets, /documents, books, signs/);
assert.match(imageAssets, /essentialSceneSemantics/);
assert.match(imageAssets, /completionFallbackReason/);
assert.doesNotMatch(imageAssets, /completionFallback:|rememberCompletionFallback|shouldUseImageCompletionFallback/);
assert.doesNotMatch(imageAssets, /best-candidate-completion-fallback|semantic_pass_style_mismatch/);
assert.match(imageAssets, /type TextFreeImageCandidate/);
assert.match(imageAssets, /const textFreeCandidate: TextFreeImageCandidate/);
assert.match(imageAssets, /let acceptedReferences: ImageReference\[\] = \[\]/);
assert.match(imageAssets, /references: generationReferences/);
assert.match(imageAssets, /referenceKeys: acceptedReferences\.map/);
assert.match(imageAssets, /generationReferences = \[\]/);
assert.match(imageAssets, /textFreeVerified: true/);
assert.match(imageAssets, /if \(!textFreeVerified\)/);
assert.doesNotMatch(imageAssets, /enforceTextFreeImagePrompt\(qualityAttempt === 0/);
assert.match(imageAssets, /const attemptBasePrompt = qualityAttempt === 0[\s\S]*buildSceneImagePrompt\(scene, project, attemptReferences, visualInstruction\)/);
assert.match(imageAssets, /qualityAttempt === 0\s*\? attemptBasePrompt/);
assert.match(imageAssets, /strategy: recoveryModelAttempt \? "recovery" : "default"/);
assert.match(imageAssets, /maxProviderAttempts/);
assert.match(imageAssets, /deadlineMs\?: number/);
assert.match(imageAssets, /operation: "Image generation"/);
assert.match(imageAssets, /operation: "Image quality validation"/);
assert.match(imageAssets, /error instanceof OperationDeadlineExceededError/);
assert.match(imageAssets, /useStockContentGuide/);
assert.match(imageAssets, /loadFreeStockImageGuide/);
assert.match(imageAssets, /acceptVerifiedStockRescue/);
assert.match(imageAssets, /verified-stock-rescue/);
assert.match(imageAssets, /normalizeFreeStockImageStyle/);
assert.match(imageAssets, /local-style-normalized-stock-rescue/);
assert.match(imageAssets, /local_style_normalized_stock_rescue/);
assert.match(imageAssets, /localStyleNormalized/);
assert.match(imageAssets, /const semanticInspectionBody = directPhotographicStock/);
assert.match(imageAssets, /evaluateCloudflareImageSemantics\(\s*semanticInspectionBody/);
assert.ok(
  imageAssets.indexOf("await acceptVerifiedStockRescue(completionStockGuide, -1)")
    < imageAssets.indexOf("for (let qualityAttempt = 0;"),
  "The zero-cost completion rescue must run before another paid provider attempt"
);
assert.match(imageAssets, /!stockRescueAttemptedBeforeGeneration && await acceptVerifiedStockRescue/);
assert.doesNotMatch(imageAssets, /reference\.role !== "content-guide"[\s\S]{0,100}!styleAllowsFreeStockVideo/);
assert.match(imageAssets, /source: usedVerifiedStockRescue \? "free-stock-image" : "generated-image"/);
assert.match(imageAssets, /styleAllowsFreeStockVideo\(lockedStyle\)/);
assert.match(imageAssets, /const pendingCostEvents: ProviderCostAttemptInput\[\] = \[\]/);
assert.match(imageAssets, /recordProviderCostAttempts\(pendingCostEvents\)/);
assert.doesNotMatch(imageAssets, /recordProviderCostAttempt\(/);
assert.match(providerCosts, /export async function recordProviderCostAttempts/);
assert.match(providerCosts, /sql\.transaction\(inputs\.map/);
assert.match(imageAssets, /\.\.\.styleAnchorReferences,[\s\S]*currentReference,[\s\S]*contentGuideReference/);
assert.match(imageAssets, /\.resize\(480, 270/);
assert.match(cloudflare, /RECOVERY_IMAGE_MODEL = "@cf\/black-forest-labs\/flux-2-dev"/);
assert.match(cloudflare, /if \(model\.includes\("flux-2-dev"\)\) form\.append\("steps"/);
assert.match(stockGuides, /api\.pexels\.com\/v1\/search/);
assert.match(stockGuides, /image_type=photo/);
assert.match(stockGuides, /excludedReferenceKeys\?: Iterable<string>/);
assert.match(stockGuides, /selectionKey\?: string/);
assert.match(stockGuides, /stockSearchTerms\(scene\)\.slice\(0, 3\)/);
assert.match(stockGuides, /AbortSignal\.timeout\(25_000\)/);
assert.match(stockGuides, /!excluded\.has\(candidateReferenceKey\(candidate\)\)/);
assert.match(imageAssets, /excludedContentGuideKeys/);
assert.match(imageAssets, /selectionKey: options\.variantKey/);
assert.match(stockGuides, /\.resize\(480, 270/);
assert.match(stockGuides, /deliveryBody/);
assert.match(stockGuides, /\.resize\(1280, 720/);
assert.match(continuity, /LIBRARY \/ READING SEMANTIC FIDELITY/);
assert.match(continuity, /Primary camera blueprint/);
assert.match(continuity, /must not remain in the same seated pose/);
assert.match(continuity, /Input image \$\{index\} \(input_image_\$\{index\}\)/);
assert.match(continuity, /FOOD \/ HOSPITALITY SEMANTIC FIDELITY/);
assert.match(continuity, /All visible books must have completely plain, unmarked covers and spines/);
assert.doesNotMatch(continuity, /Project subject for semantic context only/);
assert.match(imageAssets, /mapWithConcurrency\(targets, 1/);
assert.match(imageAssets, /currentVersion: \{ \.\.\.project\.currentVersion, scenes \}/);
const sceneFailureCatch = imageAssets.slice(
  imageAssets.indexOf("console.error(`[image-assets] Scene ${scene.sceneNumber} image generation failed"),
  imageAssets.indexOf("const assetStatus = mediaAssetStatus(scenes)")
);
assert.ok(
  sceneFailureCatch.indexOf("if (options.throwOnFailure) throw error")
    < sceneFailureCatch.indexOf("failures.push(classifyImageError(error))"),
  "Background image failures must preserve the original provider error before optional UI classification"
);
assert.doesNotMatch(imageAssets, /\.code\?\.includes|\.name\?\.includes/);

console.log("Image generation retry smoke checks passed.");
