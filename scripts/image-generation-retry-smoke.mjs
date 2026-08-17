import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync(new URL("../app/api/assets/generate/route.ts", import.meta.url), "utf8");
const imageAssets = fs.readFileSync(new URL("../lib/image-assets.ts", import.meta.url), "utf8");

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
assert.match(imageAssets, /Promise\.all\(\[/);
assert.match(imageAssets, /misspelled, cropped, blurry, nonsensical/);
assert.match(imageAssets, /palette sheet, pattern, material sample, abstract shapes, or style demonstration is invalid/);
assert.match(imageAssets, /qualityAttempt < 3/);
assert.match(imageAssets, /qualityAttempt === 2\s*\? buildTextSafeCorrectionPrompt/);
assert.match(imageAssets, /TEXT-SAFE COMPOSITION/);
assert.match(imageAssets, /生成画面包含文字或类似文字的符号/);
assert.match(imageAssets, /生成画面与当前场景内容不匹配/);

console.log("Image generation retry smoke checks passed.");
