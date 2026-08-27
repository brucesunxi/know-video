import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import sharp from "sharp";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/image-similarity.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, {
  Buffer,
  module,
  exports: module.exports,
  require: (name) => name === "sharp" ? sharp : (() => { throw new Error(`Unexpected import: ${name}`); })()
});
const {
  ADJACENT_SCENE_DUPLICATE_THRESHOLD,
  imagePerceptualSimilarity,
  POSSIBLE_SCENE_DUPLICATE_THRESHOLD
} = module.exports;

async function frame({ accent = "#22c7b8", shift = 0, background = "#dce8ef" } = {}) {
  return sharp({
    create: { width: 640, height: 360, channels: 3, background }
  })
    .composite([
      { input: Buffer.from(`<svg width="640" height="360"><rect x="${90 + shift}" y="80" width="250" height="180" rx="18" fill="${accent}"/><circle cx="${455 + shift}" cy="170" r="72" fill="#f5c46b"/></svg>`) }
    ])
    .png()
    .toBuffer();
}

const original = await frame();
const sameComposition = await frame({ shift: 4, accent: "#20bfaf" });
const differentComposition = await sharp({
  create: { width: 640, height: 360, channels: 3, background: "#132238" }
})
  .composite([{ input: Buffer.from('<svg width="640" height="360"><path d="M0 330 L320 30 L640 330 Z" fill="#f25f5c"/><rect x="30" y="30" width="95" height="280" fill="#ffe066"/></svg>') }])
  .png()
  .toBuffer();

const nearScore = await imagePerceptualSimilarity(original, sameComposition);
const differentScore = await imagePerceptualSimilarity(original, differentComposition);
assert.ok(nearScore >= ADJACENT_SCENE_DUPLICATE_THRESHOLD, `Expected near duplicate, got ${nearScore}`);
assert.ok(differentScore < ADJACENT_SCENE_DUPLICATE_THRESHOLD, `Expected distinct frame, got ${differentScore}`);
assert.ok(nearScore > differentScore + 0.15);
assert.ok(POSSIBLE_SCENE_DUPLICATE_THRESHOLD < ADJACENT_SCENE_DUPLICATE_THRESHOLD);
assert.ok(differentScore < POSSIBLE_SCENE_DUPLICATE_THRESHOLD, `Expected a genuinely different frame below review threshold, got ${differentScore}`);

console.log("Image perceptual similarity smoke checks passed.");
