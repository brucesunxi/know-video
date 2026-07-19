import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/video-assets.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

class GeneratedVideoQualityError extends Error {}
const generationCalls = [];
const uploads = [];
let inspectionCalls = 0;
const module = { exports: {} };
vm.runInNewContext(output, {
  Buffer,
  URL,
  console: { error() {}, warn() {} },
  crypto: webcrypto,
  module,
  exports: module.exports,
  require: (name) => {
    if (name === "@/lib/cloudflare-ai") return {
      hasCloudflareAI: () => true,
      generateCloudflareVideo: async (input) => {
        generationCalls.push(input);
        return { body: Buffer.alloc(100_000, generationCalls.length), model: "test-video", sourceUrl: "https://example.com/output.mp4" };
      }
    };
    if (name === "@/lib/image-continuity") return { stableImageSeed: () => 42 };
    if (name === "@/lib/r2") return {
      assetUrlForKey: (key) => `/api/assets/${key}`,
      uploadToR2: async (input) => {
        uploads.push(input);
        return { key: input.key };
      }
    };
    if (name === "@/lib/video-quality") return {
      GeneratedVideoQualityError,
      inspectGeneratedVideo: async () => {
        inspectionCalls += 1;
        if (inspectionCalls === 1) throw new GeneratedVideoQualityError("quality retry");
        return {
          container: "mp4",
          duration: 4.9,
          requestedDuration: 5,
          width: 1280,
          height: 720,
          fps: 30,
          codec: "h264",
          size: 100_000
        };
      }
    };
    throw new Error(`Unexpected import: ${name}`);
  }
});

const { generateProjectSceneClips } = module.exports;
const route = fs.readFileSync(new URL("../app/api/assets/video/generate/route.ts", import.meta.url), "utf8");
assert.match(route, /VIDEO_PROVIDER_BALANCE_REQUIRED/);
assert.match(route, /视频生成服务额度不足/);
const project = {
  id: "project",
  title: "Product story",
  currentVersion: {
    id: "version",
    renderUrl: "https://example.com/old.mp4",
    status: "ready",
    scenes: [{
      id: "scene-1",
      sceneNumber: 1,
      title: "Reveal",
      durationSeconds: 5,
      motionPrompt: "A slow camera push-in while the subject turns naturally.",
      assets: [{ id: "image", type: "image", r2Key: "image.png", url: "/api/assets/image.png" }]
    }]
  }
};

const failedResult = await generateProjectSceneClips(project, {
  assetBaseUrl: "https://know-video.example",
  sceneNumbers: [1],
  quality: "standard"
});
assert.equal(failedResult.failures.length, 1);
assert.equal(generationCalls.length, 1, "a paid video request must not retry invisibly after quality validation fails");
assert.equal(uploads.length, 0);

const result = await generateProjectSceneClips(project, {
  assetBaseUrl: "https://know-video.example",
  sceneNumbers: [1],
  quality: "standard"
});
const clip = result.project.currentVersion.scenes[0].assets[0];
assert.equal(result.failures.length, 0);
assert.equal(generationCalls.length, 2);
assert.equal(generationCalls[0].seed, generationCalls[1].seed);
assert.equal(uploads.length, 1);
assert.equal(clip.type, "clip");
assert.equal(clip.metadata.duration, 4.9);
assert.equal(clip.metadata.requestedDuration, 5);
assert.equal(clip.metadata.codec, "h264");
assert.equal(result.project.currentVersion.renderUrl, undefined);

console.log("Generated video asset orchestration smoke checks passed.");
