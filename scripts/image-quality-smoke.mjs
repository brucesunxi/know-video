import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import sharp from "sharp";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/image-quality.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, {
  module,
  exports: module.exports,
  require: (specifier) => specifier === "sharp" ? sharp : {}
});
const {
  focusedImageReviewRejectionCode,
  GeneratedImageQualityError,
  isDefinitiveGeneratedImageQualityRejection,
  normalizeGeneratedImage
} = module.exports;

assert.equal(focusedImageReviewRejectionCode({ semanticMatches: true, styleMatches: true }), undefined);
assert.equal(focusedImageReviewRejectionCode({ semanticMatches: false, styleMatches: true }), "semantic_mismatch");
assert.equal(focusedImageReviewRejectionCode({ semanticMatches: true, styleMatches: false }), "style_mismatch");
assert.equal(focusedImageReviewRejectionCode({ semanticMatches: false, styleMatches: false }), "semantic_mismatch");

assert.equal(isDefinitiveGeneratedImageQualityRejection(
  new GeneratedImageQualityError("style", "style_mismatch")
), true);
assert.equal(isDefinitiveGeneratedImageQualityRejection(
  new GeneratedImageQualityError("vision unavailable", "semantic_check_failed")
), false);
assert.equal(isDefinitiveGeneratedImageQualityRejection(
  new GeneratedImageQualityError("text inspection unavailable", "text_check_failed")
), false);

await assert.rejects(() => normalizeGeneratedImage(Buffer.from("not-an-image")), /文件过小/);

const solid = await sharp({
  create: { width: 1280, height: 720, channels: 3, background: "#777777" }
}).png({ compressionLevel: 0 }).toBuffer();
await assert.rejects(() => normalizeGeneratedImage(solid), /空白|辨识内容/);

const noisy = await sharp(randomBytes(1280 * 720 * 3), {
  raw: { width: 1280, height: 720, channels: 3 }
}).jpeg({ quality: 88 }).toBuffer();
const normalized = await normalizeGeneratedImage(noisy);
assert.equal(normalized.metadata.width, 1920);
assert.equal(normalized.metadata.height, 1080);
assert.equal(normalized.metadata.sourceFormat, "jpeg");
assert.ok(normalized.metadata.entropy > 0.8);
const outputMetadata = await sharp(normalized.body).metadata();
assert.equal(outputMetadata.format, "png");
assert.equal(outputMetadata.width, 1920);
assert.equal(outputMetadata.height, 1080);

const lowResolution = await sharp(randomBytes(1024 * 576 * 3), {
  raw: { width: 1024, height: 576, channels: 3 }
}).jpeg({ quality: 88 }).toBuffer();
await assert.rejects(() => normalizeGeneratedImage(lowResolution), /分辨率过低/);

console.log("Generated image quality smoke checks passed.");
