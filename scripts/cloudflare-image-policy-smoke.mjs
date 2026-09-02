import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/cloudflare-ai.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText;
const deadlineSource = fs.readFileSync(new URL("../lib/operation-deadline.ts", import.meta.url), "utf8");
const deadlineOutput = ts.transpileModule(deadlineSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const deadlineModule = { exports: {} };
vm.runInNewContext(deadlineOutput, { module: deadlineModule, exports: deadlineModule.exports });
const externalErrorSource = fs.readFileSync(new URL("../lib/external-error.ts", import.meta.url), "utf8");
const externalErrorOutput = ts.transpileModule(externalErrorSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const externalErrorModule = { exports: {} };
vm.runInNewContext(externalErrorOutput, {
  module: externalErrorModule,
  exports: externalErrorModule.exports,
  Number
});
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
    if (name === "@/lib/operation-deadline") return deadlineModule.exports;
    if (name === "@/lib/external-error") return externalErrorModule.exports;
    if (name === "@/lib/image-quality") return {
      GENERATED_IMAGE_WIDTH: 1920,
      GENERATED_IMAGE_HEIGHT: 1080
    };
    if (name === "sharp") return () => ({});
    return {};
  }
});

const {
  estimateCloudflareImageRequestCost,
  generateCloudflareImage,
  RECOVERY_IMAGE_HEIGHT,
  RECOVERY_IMAGE_WIDTH
} = module.exports;
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);

closeTo(estimateCloudflareImageRequestCost({
  model: "@cf/black-forest-labs/flux-2-klein-4b",
  inputImageCount: 0
}), 12 * 0.000287);
closeTo(estimateCloudflareImageRequestCost({
  model: "@cf/black-forest-labs/flux-2-klein-9b",
  inputImageCount: 1
}), 0.015 + (((1920 * 1080) / (1024 * 1024)) - 1) * 0.002 + ((480 * 270) / (1024 * 1024)) * 0.002);
closeTo(estimateCloudflareImageRequestCost({
  model: "@cf/black-forest-labs/flux-2-dev",
  inputImageCount: 2,
  width: RECOVERY_IMAGE_WIDTH,
  height: RECOVERY_IMAGE_HEIGHT,
  steps: 8
}), 8 * 8 * 0.00041 + 2 * 8 * 0.00021);

assert.equal(RECOVERY_IMAGE_WIDTH, 1792);
assert.equal(RECOVERY_IMAGE_HEIGHT, 1008);

assert.match(source, /strategy\?: "default" \| "recovery"/);
assert.match(source, /options\.strategy === "recovery"/);
assert.match(source, /providerAttempts/);
assert.match(source, /attachImageAttemptMetadata/);
assert.match(source, /IMAGE_PROVIDER_TIMEOUT_MS = 100_000/);
assert.match(source, /maxProviderAttempts\?: number/);
assert.match(source, /deadlineMs\?: number/);
assert.match(source, /operation: "Cloudflare image generation"/);
assert.match(source, /operation: "Cloudflare vision validation"/);

env.CLOUDFLARE_AI_ACCOUNT_ID = "test-account";
env.CLOUDFLARE_AI_TOKEN = "test-token";
let requestCount = 0;
fetchHandler = async () => {
  requestCount += 1;
  throw new Error("fetch must not start after the deadline");
};
await assert.rejects(
  () => generateCloudflareImage("expired", "standard", { deadlineMs: Date.now() - 1 }),
  (error) => {
    assert.equal(error.providerAttempts, 0);
    assert.equal(error.estimatedCostUsd, 0);
    return true;
  }
);
assert.equal(requestCount, 0);

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
closeTo(recovered.estimatedCostUsd, 2 * 12 * 0.000287);

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
    closeTo(error.estimatedCostUsd, 2 * 12 * 0.000287);
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

let recoveryDimensions;
requestCount = 0;
fetchHandler = async (_url, options) => {
  requestCount += 1;
  recoveryDimensions = {
    width: options.body.get("width"),
    height: options.body.get("height")
  };
  return {
    ok: true,
    status: 200,
    json: async () => ({ result: { image: Buffer.from("recovery-image").toString("base64") } })
  };
};
const recovery = await generateCloudflareImage("recovery prompt", "premium", {
  strategy: "recovery",
  maxProviderAttempts: 1
});
assert.deepEqual(recoveryDimensions, { width: "1792", height: "1008" });
closeTo(recovery.estimatedCostUsd, 8 * 8 * 0.00041);
assert.equal(requestCount, 1);

console.log("Cloudflare image policy smoke checks passed.");
