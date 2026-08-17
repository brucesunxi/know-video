import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync(new URL("../app/api/assets/generate/route.ts", import.meta.url), "utf8");
const imageAssets = fs.readFileSync(new URL("../lib/image-assets.ts", import.meta.url), "utf8");

assert.match(route, /function imageFailedScenes/);
assert.match(route, /requestedSceneNumbers/);
assert.match(route, /for \(let retry = 0; retry < 2 && failedTargets\.length > 0; retry \+= 1\)/);
assert.match(route, /Retrying failed image scenes/);
assert.match(route, /generateProjectSceneImages\(updated, \{/);
assert.match(route, /sceneNumbers: retrySceneNumbers/);
assert.match(route, /variantKey: `repair-\$\{retry \+ 1\}-\$\{crypto\.randomUUID\(\)\}`/);
assert.match(route, /persistGeneratedSceneAssets/);
assert.ok(route.indexOf("Retrying failed image scenes") < route.lastIndexOf("persistGeneratedSceneAssets"));
assert.match(route, /mediaGenerationProgress\(\s*requestedSceneNumbers,/);
assert.match(imageAssets, /inspectGeneratedImage/);
assert.match(imageAssets, /inspectCloudflareGeneratedImage/);
assert.match(imageAssets, /palette sheet, pattern, material sample, abstract shapes, or style demonstration is invalid/);
assert.match(imageAssets, /qualityAttempt < 3/);
assert.match(imageAssets, /qualityAttempt === 2\s*\? buildTextSafeCorrectionPrompt/);
assert.match(imageAssets, /TEXT-SAFE COMPOSITION/);
assert.match(imageAssets, /生成画面包含文字或类似文字的符号/);
assert.match(imageAssets, /生成画面与当前场景内容不匹配/);

console.log("Image generation retry smoke checks passed.");
