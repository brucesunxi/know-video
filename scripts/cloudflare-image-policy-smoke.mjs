import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/cloudflare-ai.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText;
const module = { exports: {} };
const env = {};
let fetchHandler = fetch;
vm.runInNewContext(output, {
  module,
  exports: module.exports,
  Buffer,
  Blob,
  FormData,
  AbortSignal,
  fetch: (...args) => fetchHandler(...args),
  setTimeout: (callback) => {
    callback();
    return 0;
  },
  require: (name) => {
    if (name === "@/lib/env") return { getOptionalEnv: (key) => env[key] };
    if (name === "@/lib/video-cost-policy") return {
      VIDEO_GENERATION_DURATION_SECONDS: 3,
      VIDEO_GENERATION_MODEL: "test-video",
      VIDEO_GENERATION_TIERS: {}
    };
    if (name === "sharp") return () => ({});
    return {};
  }
});

const { estimateCloudflareImageRequestCost, generateCloudflareImage } = module.exports;
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);

closeTo(estimateCloudflareImageRequestCost({
  model: "@cf/black-forest-labs/flux-2-klein-4b",
  inputImageCount: 0
}), 6 * 0.000287);
closeTo(estimateCloudflareImageRequestCost({
  model: "@cf/black-forest-labs/flux-2-klein-9b",
  inputImageCount: 1
}), 0.015 + ((480 * 270) / (1024 * 1024)) * 0.002);
closeTo(estimateCloudflareImageRequestCost({
  model: "@cf/black-forest-labs/flux-2-dev",
  inputImageCount: 2,
  steps: 8
}), 6 * 8 * 0.00041 + 2 * 8 * 0.00021);

assert.match(source, /strategy\?: "default" \| "recovery"/);
assert.match(source, /options\.strategy === "recovery"/);
assert.match(source, /providerAttempts/);
assert.match(source, /attachImageAttemptMetadata/);
assert.match(source, /IMAGE_PROVIDER_TIMEOUT_MS = 75_000/);
assert.match(source, /maxProviderAttempts\?: number/);

env.CLOUDFLARE_AI_ACCOUNT_ID = "test-account";
env.CLOUDFLARE_AI_TOKEN = "test-token";
let requestCount = 0;
fetchHandler = async () => {
  requestCount += 1;
  if (requestCount === 1) {
    return {
      ok: false,
      status: 503,
      json: async () => ({ errors: [{ code: 1000, message: "temporarily unavailable" }] })
    };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ result: { image: Buffer.from("image-bytes").toString("base64") } })
  };
};
const recovered = await generateCloudflareImage("test prompt", "standard");
assert.equal(recovered.providerAttempts, 2);
assert.equal(requestCount, 2);
closeTo(recovered.estimatedCostUsd, 2 * 6 * 0.000287);

requestCount = 0;
fetchHandler = async () => {
  requestCount += 1;
  return {
    ok: false,
    status: 503,
    json: async () => ({ errors: [{ code: 1000, message: "temporarily unavailable" }] })
  };
};
await assert.rejects(
  () => generateCloudflareImage("test prompt", "standard"),
  (error) => {
    assert.equal(error.providerAttempts, 2);
    assert.equal(error.actualModel, "@cf/black-forest-labs/flux-2-klein-4b");
    closeTo(error.estimatedCostUsd, 2 * 6 * 0.000287);
    return true;
  }
);
assert.equal(requestCount, 2);

requestCount = 0;
await assert.rejects(
  () => generateCloudflareImage("single attempt", "standard", { maxProviderAttempts: 1 }),
  (error) => {
    assert.equal(error.providerAttempts, 1);
    return true;
  }
);
assert.equal(requestCount, 1);

console.log("Cloudflare image policy smoke checks passed.");
