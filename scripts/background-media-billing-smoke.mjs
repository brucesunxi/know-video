import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/background-media-billing.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports });

const { backgroundBillingMarkerForAsset, tagAssetForBackgroundBilling } = module.exports;
const asset = {
  id: "image-1",
  type: "image",
  url: "/image.png",
  r2Key: "generated/image.png",
  metadata: { source: "generated-image", model: "flux" }
};
const tagged = tagAssetForBackgroundBilling(asset, {
  requestId: "request-1",
  resourceType: "image_premium",
  quantity: 1
});

assert.equal(asset.metadata.backgroundGenerationRequestId, undefined);
assert.equal(tagged.metadata.source, "generated-image");
assert.deepEqual(
  { ...backgroundBillingMarkerForAsset(tagged, "request-1") },
  { requestId: "request-1", resourceType: "image_premium", quantity: 1 }
);
assert.equal(backgroundBillingMarkerForAsset(tagged, "request-2"), undefined);
assert.equal(backgroundBillingMarkerForAsset({
  ...tagged,
  metadata: { ...tagged.metadata, backgroundBillingResourceType: "video" }
}, "request-1"), undefined);
assert.equal(backgroundBillingMarkerForAsset({
  ...tagged,
  metadata: { ...tagged.metadata, backgroundBillingQuantity: 0 }
}, "request-1"), undefined);
assert.throws(() => tagAssetForBackgroundBilling(asset, {
  requestId: " ",
  resourceType: "speech",
  quantity: 3
}), /request id/i);
assert.throws(() => tagAssetForBackgroundBilling(asset, {
  requestId: "request-1",
  resourceType: "speech",
  quantity: 0
}), /quantity/i);

const worker = fs.readFileSync(new URL("../lib/background-media-generation.ts", import.meta.url), "utf8");
const imageSection = worker.slice(
  worker.indexOf("async function ensureSceneImage"),
  worker.indexOf("async function ensureSceneNarration")
);
const narrationSection = worker.slice(
  worker.indexOf("async function ensureSceneNarration"),
  worker.indexOf("async function addFreeStockMotion")
);

assert.match(imageSection, /sceneHasVisualAsset\(targetScene\)[\s\S]*settleBackgroundImageUsage/);
assert.match(narrationSection, /if \(existingAudio\)[\s\S]*settleBackgroundNarrationUsage/);
assert.ok(imageSection.indexOf("tagAssetForBackgroundBilling") < imageSection.indexOf("persistGeneratedSceneAssets"));
assert.ok(imageSection.indexOf("persistGeneratedSceneAssets") < imageSection.indexOf("settleBackgroundImageUsage(message, generated)"));
assert.match(imageSection, /const zeroCostVisualRescue = generated\.metadata\?\.source === "free-stock-image"[\s\S]*generated\.metadata\?\.source === "local-safe-visual"/);
assert.match(imageSection, /if \(!zeroCostVisualRescue\) \{[\s\S]*tagAssetForBackgroundBilling/);
assert.match(imageSection, /if \(!zeroCostVisualRescue\) await settleBackgroundImageUsage\(message, generated\)/);
assert.ok(narrationSection.indexOf("tagAssetForBackgroundBilling") < narrationSection.indexOf("persistGeneratedSceneAssets"));
assert.ok(narrationSection.indexOf("persistGeneratedSceneAssets") < narrationSection.indexOf("settleBackgroundNarrationUsage(message, generated)"));
assert.equal((narrationSection.match(/persistGeneratedSceneAssets/g) ?? []).length, 1);

console.log("Background media billing recovery smoke checks passed.");
