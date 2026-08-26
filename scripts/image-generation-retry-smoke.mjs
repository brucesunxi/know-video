import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync(new URL("../app/api/assets/generate/route.ts", import.meta.url), "utf8");
const imageAssets = fs.readFileSync(new URL("../lib/image-assets.ts", import.meta.url), "utf8");
const completionPolicy = fs.readFileSync(new URL("../lib/image-completion-policy.ts", import.meta.url), "utf8");
const continuity = fs.readFileSync(new URL("../lib/image-continuity.ts", import.meta.url), "utf8");

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
assert.match(imageAssets, /detectCloudflareImageText\(inspectionBody\)/);
const textInspection = imageAssets.slice(
  imageAssets.indexOf("async function generatedImageContainsAnyText"),
  imageAssets.indexOf("async function loadImageReference")
);
assert.ok(
  textInspection.indexOf("hasCloudflareAI()") < textInspection.indexOf("OPENAI_API_KEY"),
  "Cloudflare text inspection must run before the optional OpenAI fallback"
);
assert.ok(
  imageAssets.indexOf("await generatedImageContainsAnyText(normalized.body)")
    < imageAssets.indexOf("await inspectGeneratedImage(normalized.body, scene, project)"),
  "Text rejection must remain a hard gate before recoverable semantic/style inspection"
);
assert.match(imageAssets, /misspelled, cropped, blurry, nonsensical/);
assert.match(imageAssets, /palette sheet, pattern, material sample, abstract shapes, or style demonstration is invalid/);
assert.match(imageAssets, /qualityAttempt < qualityAttemptLimit/);
assert.match(imageAssets, /qualityAttempt === qualityAttemptLimit - 1/);
assert.match(imageAssets, /TEXT-SAFE COMPOSITION/);
assert.match(imageAssets, /生成画面包含文字或类似文字的符号/);
assert.match(imageAssets, /生成画面与当前场景内容不匹配/);
assert.match(imageAssets, /生成画面偏离项目锁定的视觉风格/);
assert.match(imageAssets, /STYLE_MISMATCH/);
assert.match(imageAssets, /MAX_IMAGE_QUALITY_ATTEMPTS = 4/);
assert.match(imageAssets, /allowStyleFallback = false/);
assert.match(imageAssets, /allowCompletionFallback = false/);
assert.match(imageAssets, /evaluateCloudflareImageSemantics/);
assert.match(imageAssets, /text-free-semantic-pass-style-fallback/);
assert.match(imageAssets, /qualityGate: usedStyleFallback/);
assert.match(imageAssets, /inspection === "style_mismatch" && allowStyleFallback/);
assert.match(imageAssets, /inspection-fallback-semantic/);
assert.match(imageAssets, /validator formatting glitches/);
assert.doesNotMatch(imageAssets, /betterTextFreeCandidate/);
assert.match(imageAssets, /composition_duplicate/);
assert.match(imageAssets, /ADJACENT_SCENE_DUPLICATE_THRESHOLD/);
assert.match(imageAssets, /loadProjectStyleAnchorReferences/);
assert.match(imageAssets, /const selected = \[nearest, contrasting\]/);
assert.match(imageAssets, /const attemptReferences = usableReferences/);
assert.doesNotMatch(imageAssets, /reference\.role !== "style-anchor"/);
assert.match(imageAssets, /LIBRARY TEXT-SAFE OBJECT RULE/);
assert.match(imageAssets, /every book cover and spine as a completely plain unmarked/);
assert.doesNotMatch(imageAssets, /documents, books, signs/);
assert.match(imageAssets, /essentialSceneSemantics/);
assert.match(imageAssets, /if \(styleFallback \|\| \(allowCompletionFallback && completionFallback\)\) break/);
assert.match(imageAssets, /rememberCompletionFallback/);
assert.match(imageAssets, /best-candidate-completion-fallback/);
assert.match(imageAssets, /completionFallbackReason/);
assert.match(imageAssets, /semantic_pass_style_mismatch/);
assert.match(imageAssets, /allowCompletionFallback && \(styleFallback \|\| completionFallback\)/);
assert.match(imageAssets, /shouldUseImageCompletionFallback/);
assert.match(imageAssets, /type TextFreeImageCandidate/);
assert.match(imageAssets, /const textFreeCandidate: TextFreeImageCandidate/);
assert.match(imageAssets, /textFreeVerified: true/);
assert.match(imageAssets, /if \(!textFreeVerified\)/);
assert.doesNotMatch(imageAssets, /rememberCompletionFallback\(normalizedCandidate/);
assert.doesNotMatch(imageAssets, /rememberCompletionFallback\([^\n]+, "text_detected"\)/);
assert.match(completionPolicy, /IMAGE_COMPLETION_FALLBACK_SCORES/);
assert.doesNotMatch(completionPolicy, /technical_only|text_detected|combined_text_disagreement|text_free_nonduplicate/);
assert.match(completionPolicy, /semantic_pass_style_mismatch: 90/);
assert.match(completionPolicy, /updatesSameCandidate/);
assert.match(continuity, /LIBRARY \/ READING SEMANTIC FIDELITY/);
assert.match(continuity, /Primary camera blueprint/);
assert.match(continuity, /All visible books must have completely plain, unmarked covers and spines/);
assert.doesNotMatch(continuity, /Project subject for semantic context only/);
assert.match(imageAssets, /mapWithConcurrency\(targets, 1/);
assert.match(imageAssets, /currentVersion: \{ \.\.\.project\.currentVersion, scenes \}/);

console.log("Image generation retry smoke checks passed.");
