import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import sharp from "sharp";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/local-stock-image-style.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, {
  module,
  exports: module.exports,
  require: (specifier) => specifier === "sharp" ? sharp : {}
});
const { localStockImageStyleMode, normalizeFreeStockImageStyle } = module.exports;

const sample = fs.readFileSync(new URL("../public/template-previews/tour.webp", import.meta.url));

const styles = [
  "cinematic-realism",
  "chalkboard",
  "simple-line",
  "collage",
  "comic-book",
  "memphis",
  "isometric",
  "pixel-art",
  "safety-poster",
  "product-ui"
];
const expectedModes = [
  "photographic",
  "chalkboard",
  "line-art",
  "paper-collage",
  "comic-book",
  "flat-illustration",
  "isometric-illustration",
  "pixel-art",
  "safety-poster",
  "product-illustration"
];
const hashes = new Map();
const previews = [];

for (const [index, visualStyleId] of styles.entries()) {
  assert.equal(localStockImageStyleMode({ visualStyleId }), expectedModes[index]);
  const result = await normalizeFreeStockImageStyle(sample, { visualStyleId });
  assert.equal(result.mode, expectedModes[index]);
  const metadata = await sharp(result.body).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 1280);
  assert.equal(metadata.height, 720);
  assert.ok(result.body.byteLength > 8_000, `${result.mode} output was only ${result.body.byteLength} bytes`);
  const stats = await sharp(result.body).resize(160, 90).greyscale().stats();
  assert.ok((stats.entropy ?? 0) > 0.8, `${result.mode} lost too much scene detail`);
  assert.ok((stats.channels[0]?.stdev ?? 0) > 5, `${result.mode} became visually empty`);
  if (result.mode === "safety-poster") {
    const { data, info } = await sharp(result.body).resize(80, 45).raw().toBuffer({ resolveWithObject: true });
    const colors = new Set();
    for (let offset = 0; offset < data.length; offset += info.channels) {
      colors.add(`${data[offset]}:${data[offset + 1]}:${data[offset + 2]}`);
    }
    assert.ok(colors.size >= 24, `safety-poster collapsed into ${colors.size} harsh duotone colors`);
  }
  const hash = createHash("sha256").update(result.body).digest("hex");
  assert.equal(hashes.get(hash), undefined, `${result.mode} unexpectedly matched ${hashes.get(hash)}`);
  hashes.set(hash, result.mode);
  previews.push({
    input: await sharp(result.body).resize(320, 180).png().toBuffer(),
    left: (index % 5) * 320,
    top: Math.floor(index / 5) * 180
  });
}

assert.equal(hashes.size, styles.length);
await sharp({
  create: { width: 1600, height: 360, channels: 3, background: "#ffffff" }
}).composite(previews).png().toFile("/tmp/know-video-local-stock-style-smoke.png");

console.log("Local stock image style normalization smoke checks passed.");
