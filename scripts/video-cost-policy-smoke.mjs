import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/video-cost-policy.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports });
const {
  VIDEO_GENERATION_DURATION_SECONDS,
  VIDEO_GENERATION_MODEL,
  videoGenerationEstimate,
  isVideoGenerationTier
} = module.exports;

assert.equal(VIDEO_GENERATION_MODEL, "xai/grok-imagine-video");
assert.equal(VIDEO_GENERATION_DURATION_SECONDS, 3);
assert.equal(videoGenerationEstimate("economy").estimatedUsd, 0.16);
assert.equal(videoGenerationEstimate("economy").resolution, "480p");
assert.equal(videoGenerationEstimate("balanced").estimatedUsd, 0.23);
assert.equal(videoGenerationEstimate("balanced").resolution, "720p");
assert.equal(isVideoGenerationTier("economy"), true);
assert.equal(isVideoGenerationTier("unlimited"), false);

const cloudflare = fs.readFileSync(new URL("../lib/cloudflare-ai.ts", import.meta.url), "utf8");
assert.doesNotMatch(cloudflare, /alibaba\/hh1\.1-i2v/);
assert.doesNotMatch(cloudflare, /CLOUDFLARE_VIDEO_MODEL/);
assert.match(cloudflare, /image: \{ url: input\.imageUrl \}/);

console.log("Video generation cost policy smoke checks passed.");
