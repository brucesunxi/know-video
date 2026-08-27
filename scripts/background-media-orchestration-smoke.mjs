import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function compileModule(path) {
  const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
}

const billingMarkerModule = { exports: {} };
vm.runInNewContext(compileModule("../lib/background-media-billing.ts"), {
  module: billingMarkerModule,
  exports: billingMarkerModule.exports
});

class GeneratedImageQualityError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "GeneratedImageQualityError";
    this.code = code;
  }
}

class InsufficientCreditsError extends Error {}

const clone = (value) => structuredClone(value);
const newScene = (sceneNumber) => ({
  id: `scene-${sceneNumber}`,
  sceneNumber,
  title: `Scene ${sceneNumber}`,
  voiceover: `Narration ${sceneNumber}`,
  visualPrompt: `Visual ${sceneNumber}`,
  motionPrompt: "Slow push in",
  durationSeconds: 5,
  style: { theme: "cinematic", mood: "warm", palette: ["#ffffff"] },
  assets: []
});
const newProject = (sceneCount) => ({
  id: "project-1",
  title: "Test project",
  currentVersion: {
    id: "version-1",
    status: "draft",
    scenes: Array.from({ length: sceneCount }, (_, index) => newScene(index + 1))
  }
});

let state;
let enqueued;
let usageByKey;
let usageAttempts;
let imageGenerationCount;
let narrationGenerationCount;
let completedCount;
let releasedCount;
let refundedCount;
let failedCount;
let generationRequestHeartbeat;
let imageSettlementFailures;
let narrationSettlementFailures;
let imageQualityFailures;
let generationRecord;
let stockProviderAvailable;
let stockClipOutcomes;
let stockGenerationCount;
let watchdogEnqueuedCount;

function reset(sceneCount = 1) {
  state = newProject(sceneCount);
  enqueued = [];
  usageByKey = new Map();
  usageAttempts = new Map();
  imageGenerationCount = 0;
  narrationGenerationCount = 0;
  completedCount = 0;
  releasedCount = 0;
  refundedCount = 0;
  failedCount = 0;
  generationRequestHeartbeat = { pending: true, createdAt: new Date().toISOString() };
  imageSettlementFailures = 0;
  narrationSettlementFailures = 0;
  imageQualityFailures = new Map();
  stockProviderAvailable = false;
  stockClipOutcomes = [];
  stockGenerationCount = 0;
  watchdogEnqueuedCount = 0;
  const now = new Date().toISOString();
  generationRecord = {
    id: "request-1",
    status: "pending",
    projectId: "project-1",
    engine: "ai",
    options: { motion: "camera", language: "中文" },
    createdAt: now,
    updatedAt: now
  };
}

function replacePersistedScenes(scenes, sceneNumbers) {
  const selected = sceneNumbers ? new Set(sceneNumbers) : undefined;
  const replacements = new Map(scenes
    .filter((scene) => !selected || selected.has(scene.sceneNumber))
    .map((scene) => [scene.sceneNumber, clone(scene)]));
  state.currentVersion.scenes = state.currentVersion.scenes.map((scene) => (
    replacements.get(scene.sceneNumber) ?? scene
  ));
}

async function generateProjectSceneImages(project, options) {
  imageGenerationCount += 1;
  const sceneNumber = options.sceneNumbers[0];
  const failures = imageQualityFailures.get(sceneNumber) ?? 0;
  if (failures > 0) {
    imageQualityFailures.set(sceneNumber, failures - 1);
    throw new GeneratedImageQualityError("style mismatch", "style_mismatch");
  }
  const updated = clone(project);
  const scene = updated.currentVersion.scenes.find((candidate) => candidate.sceneNumber === sceneNumber);
  scene.assets = [{
    id: `image-${sceneNumber}`,
    type: "image",
    r2Key: `generated/image-${sceneNumber}.png`,
    url: `/image-${sceneNumber}.png`,
    metadata: {
      source: "generated-image",
      model: options.quality === "premium" ? "flux-premium" : "flux-standard",
      textFreeVerified: true,
      qualityGate: "strict-semantic-style-pass",
      providerRequestCount: 1,
      validationRequestCount: 2,
      estimatedActualCostUsd: 0.01
    }
  }, ...scene.assets.filter((asset) => asset.type !== "image" && asset.type !== "clip")];
  return updated;
}

async function generateProjectVoices(project, sceneNumbers) {
  narrationGenerationCount += 1;
  const sceneNumber = sceneNumbers[0];
  const updated = clone(project);
  const scene = updated.currentVersion.scenes.find((candidate) => candidate.sceneNumber === sceneNumber);
  scene.assets = [{
    id: `audio-${sceneNumber}`,
    type: "audio",
    r2Key: `generated/audio-${sceneNumber}.wav`,
    url: `/audio-${sceneNumber}.wav`,
    metadata: {
      source: "ai-speech",
      model: "neural-tts",
      actualDurationSeconds: 5
    }
  }, ...scene.assets.filter((asset) => asset.type !== "audio")];
  return updated;
}

async function generateProjectStockClips(project, sceneNumbers) {
  stockGenerationCount += 1;
  const sceneNumber = sceneNumbers[0];
  if (!stockClipOutcomes.shift()) {
    return {
      project,
      failures: [{ sceneNumber, error: new Error("no stock match") }],
      styleProtectedSceneNumbers: []
    };
  }
  const updated = clone(project);
  const scene = updated.currentVersion.scenes.find((candidate) => candidate.sceneNumber === sceneNumber);
  scene.assets = [{
    id: `clip-${sceneNumber}`,
    type: "clip",
    r2Key: `stock/clip-${sceneNumber}.mp4`,
    url: `/clip-${sceneNumber}.mp4`,
    metadata: { source: "free-stock-video", costUsd: 0 }
  }, ...scene.assets.filter((asset) => asset.type !== "clip")];
  return { project: updated, failures: [], styleProtectedSceneNumbers: [] };
}

async function recordUsageEvent(input) {
  usageAttempts.set(input.idempotencyKey, (usageAttempts.get(input.idempotencyKey) ?? 0) + 1);
  if (input.resourceType.startsWith("image_") && imageSettlementFailures > 0) {
    imageSettlementFailures -= 1;
    throw new Error("temporary image settlement failure");
  }
  if (input.resourceType === "speech" && narrationSettlementFailures > 0) {
    narrationSettlementFailures -= 1;
    throw new Error("temporary narration settlement failure");
  }
  if (!usageByKey.has(input.idempotencyKey)) usageByKey.set(input.idempotencyKey, clone(input));
  return { recorded: true, duplicate: usageByKey.has(input.idempotencyKey) };
}

const mocks = {
  "@/lib/audio-assets": { generateProjectVoices },
  "@/lib/billing/usage": {
    InsufficientCreditsError,
    recordUsageEvent,
    reserveAdditionalCredits: async () => undefined
  },
  "@/lib/billing/estimate": {
    estimateBilling: (items) => ({
      maximumCredits: items[0]?.resourceType === "image_premium" ? 20 : 10,
      estimatedProviderCostUsd: items[0]?.resourceType === "image_premium" ? 0.02 : 0.01
    })
  },
  "@/lib/generation-requests": {
    completeGenerationRequest: async (input) => {
      completedCount += 1;
      if (input.billingReservationKey) releasedCount += 1;
      return { completed: true, releasedCredits: input.billingReservationKey ? 1 : 0 };
    },
    failGenerationRequest: async (input) => {
      failedCount += 1;
      if (input.billingReservationKey) refundedCount += 1;
      return { failed: true, refundedCredits: input.billingReservationKey ? 1 : 0 };
    },
    getGenerationRequestBeforeExpiry: async () => clone(generationRecord),
    touchGenerationRequest: async () => generationRequestHeartbeat
  },
  "@/lib/image-assets": { generateProjectSceneImages },
  "@/lib/media-generation-queue": {
    enqueueProjectGenerationWatchdog: async () => { watchdogEnqueuedCount += 1; },
    enqueueProjectMediaScene: async (message) => { enqueued.push(clone(message)); }
  },
  "@/lib/generation-lifecycle-policy": {
    elapsedGenerationMs: (value) => Date.now() - new Date(value).getTime(),
    GENERATION_PLANNING_TIMEOUT_MINUTES: 15,
    generationExceededRuntime: (value) => Date.now() - new Date(value).getTime() >= 40 * 60 * 1_000,
    generationMediaIsInactive: (value) => Date.now() - new Date(value).getTime() >= 8 * 60 * 1_000,
    generationResumeAttempt: () => 1
  },
  "@/lib/project-mutations": {
    loadProjectForRender: async () => clone(state),
    persistGeneratedSceneAssets: async (_versionId, scenes, options) => {
      replacePersistedScenes(scenes, options.sceneNumbers);
    }
  },
  "@/lib/project-store": {
    getProjectSnapshot: async () => ({ project: clone(state), messages: [] })
  },
  "@/lib/stock-video-assets": {
    generateProjectStockClips,
    hasFreeStockVideoProvider: () => stockProviderAvailable
  },
  "@/lib/image-continuity": { sceneRequiresPremiumImage: () => false },
  "@/lib/image-quality": {
    GeneratedImageQualityError,
    isDefinitiveGeneratedImageQualityRejection: () => true
  },
  "@/lib/generation-resume": {
    isDeliverableVisualAsset: (asset) => asset.type === "image" && asset.metadata?.textFreeVerified === true,
    sceneHasAudioAsset: (scene) => scene.assets.some((asset) => asset.type === "audio" && asset.url),
    sceneHasVisualAsset: (scene) => scene.assets.some((asset) => (
      (asset.type === "clip" && asset.url)
      || (asset.type === "image" && asset.url && asset.metadata?.textFreeVerified === true)
    ))
  },
  "@/lib/background-recovery-policy": {
    backgroundImageAttemptPlan: ({ deliveryCount, recoveryPass = 0, requiresPremium }) => ({
      completionRescue: deliveryCount >= 2 || recoveryPass > 0,
      recoveryCycle: recoveryPass > 0,
      requestedQuality: requiresPremium || deliveryCount >= 2 || recoveryPass > 0 ? "premium" : "standard",
      maxQualityAttempts: deliveryCount >= 2 || recoveryPass > 0 ? 2 : 1,
      useStockContentGuide: deliveryCount >= 2 || recoveryPass > 0
    }),
    canContinueAfterSceneQualityFailure: () => true,
    MAX_PROJECT_MEDIA_RECOVERY_PASSES: 1,
    nextProjectRecoveryPass: (currentPass = 0) => currentPass + 1
  },
  "@/lib/background-media-billing": billingMarkerModule.exports
};

const workerModule = { exports: {} };
vm.runInNewContext(compileModule("../lib/background-media-generation.ts"), {
  module: workerModule,
  exports: workerModule.exports,
  console: { info() {}, warn() {}, error() {} },
  Date,
  require: (name) => {
    if (mocks[name]) return mocks[name];
    throw new Error(`Unexpected import: ${name}`);
  }
});

const { processProjectGenerationWatchdog, processProjectMediaScene } = workerModule.exports;
const message = (sceneNumber, overrides = {}) => ({
  requestId: "request-1",
  userId: "user-1",
  projectId: "project-1",
  versionId: "version-1",
  sceneNumber,
  engine: "ai",
  billingReservationKey: "reservation-1",
  options: { motion: "camera", language: "中文" },
  ...overrides
});

reset(2);
await processProjectMediaScene(message(1), 1);
assert.deepEqual(enqueued.map((item) => item.sceneNumber), [2]);
await processProjectMediaScene(enqueued.shift(), 1);
assert.equal(completedCount, 1);
assert.equal(releasedCount, 1);
assert.equal(usageByKey.size, 4);
assert.equal(state.currentVersion.scenes.every((scene) => (
  scene.assets.some((asset) => asset.type === "image")
  && scene.assets.some((asset) => asset.type === "audio")
)), true);

reset(1);
stockProviderAvailable = true;
stockClipOutcomes = [true];
await processProjectMediaScene(message(1, { options: { motion: "stock", language: "中文" } }), 1);
assert.equal(stockGenerationCount, 1);
assert.equal(imageGenerationCount, 0);
assert.equal(state.currentVersion.scenes[0].assets.some((asset) => asset.type === "clip"), true);
assert.equal(usageByKey.has("speech:request-1:scene:1"), true);
assert.equal([...usageByKey.values()].some((usage) => usage.resourceType.startsWith("image_")), false);
assert.equal(completedCount, 1);

reset(1);
stockProviderAvailable = true;
stockClipOutcomes = [false, true];
imageQualityFailures.set(1, 1);
await processProjectMediaScene(message(1), 1);
assert.deepEqual(enqueued.map((item) => [item.sceneNumber, item.recoveryPass]), [[1, 1]]);
await processProjectMediaScene(enqueued.shift(), 1);
assert.equal(stockGenerationCount, 2);
assert.equal(imageGenerationCount, 1);
assert.equal(state.currentVersion.scenes[0].assets.some((asset) => asset.type === "clip"), true);
assert.equal(completedCount, 1);

reset(1);
imageSettlementFailures = 1;
await processProjectMediaScene(message(1), 1);
assert.equal(imageGenerationCount, 1);
assert.equal(usageByKey.has("image_standard:request-1:scene:1"), true);
assert.equal(usageAttempts.get("image_standard:request-1:scene:1"), 2);
assert.equal(completedCount, 1);

reset(1);
imageSettlementFailures = 2;
await assert.rejects(() => processProjectMediaScene(message(1), 1), /temporary image settlement failure/);
assert.equal(state.currentVersion.scenes[0].assets.some((asset) => asset.type === "image"), true);
await processProjectMediaScene(message(1), 2);
assert.equal(imageGenerationCount, 1);
assert.equal(usageByKey.has("image_standard:request-1:scene:1"), true);
assert.equal(completedCount, 1);

reset(1);
narrationSettlementFailures = 2;
await assert.rejects(() => processProjectMediaScene(message(1), 1), /temporary narration settlement failure/);
assert.equal(state.currentVersion.scenes[0].assets.some((asset) => asset.type === "audio"), true);
await processProjectMediaScene(message(1), 2);
assert.equal(narrationGenerationCount, 1);
assert.equal(usageByKey.has("speech:request-1:scene:1"), true);
assert.equal(completedCount, 1);

reset(2);
imageQualityFailures.set(1, 1);
await processProjectMediaScene(message(1), 1);
assert.deepEqual(enqueued.map((item) => [item.sceneNumber, item.recoveryPass ?? 0]), [[2, 0]]);
await processProjectMediaScene(enqueued.shift(), 1);
assert.deepEqual(enqueued.map((item) => [item.sceneNumber, item.recoveryPass]), [[1, 1]]);
await processProjectMediaScene(enqueued.shift(), 1);
assert.equal(completedCount, 1);
assert.equal(releasedCount, 1);
assert.equal(state.currentVersion.scenes.every((scene) => (
  scene.assets.some((asset) => asset.type === "image")
  && scene.assets.some((asset) => asset.type === "audio")
)), true);

reset(1);
imageQualityFailures.set(1, 2);
await processProjectMediaScene(message(1), 1);
await assert.rejects(
  () => processProjectMediaScene(enqueued.shift(), 1),
  (error) => error?.name === "ProjectMediaQualityExhaustedError"
);
assert.equal(completedCount, 0);

reset(1);
generationRequestHeartbeat = { pending: false };
await processProjectMediaScene(message(1), 1);
assert.equal(imageGenerationCount, 0);
assert.equal(narrationGenerationCount, 0);
assert.equal(usageByKey.size, 0);
assert.equal(completedCount, 0);

reset(1);
generationRequestHeartbeat = {
  pending: true,
  createdAt: new Date(Date.now() - 36 * 60 * 1_000).toISOString()
};
await processProjectMediaScene(message(1), 1);
assert.equal(imageGenerationCount, 0);
assert.equal(narrationGenerationCount, 0);
assert.equal(failedCount, 1);
assert.equal(refundedCount, 1);

reset(1);
await processProjectMediaScene(message(1), 1);
completedCount = 0;
releasedCount = 0;
await processProjectGenerationWatchdog({
  operation: "watchdog",
  requestId: "request-1",
  userId: "user-1",
  billingReservationKey: "reservation-1"
});
assert.equal(completedCount, 1);
assert.equal(releasedCount, 1);
assert.equal(failedCount, 0);
assert.equal(refundedCount, 0);
assert.equal(usageByKey.size, 2);

reset(2);
await processProjectMediaScene(message(1), 1);
await processProjectGenerationWatchdog({
  operation: "watchdog",
  requestId: "request-1",
  userId: "user-1",
  billingReservationKey: "reservation-1"
});
assert.equal(completedCount, 0);
assert.equal(failedCount, 0);
assert.equal(refundedCount, 0);
assert.equal(watchdogEnqueuedCount, 1);

reset(2);
generationRecord.updatedAt = new Date(Date.now() - 9 * 60 * 1_000).toISOString();
await processProjectGenerationWatchdog({
  operation: "watchdog",
  requestId: "request-1",
  userId: "user-1",
  billingReservationKey: "reservation-1"
});
assert.deepEqual(enqueued.map((item) => [item.sceneNumber, item.resumeAttempt, item.recoveryPass]), [[1, 1, 0]]);
assert.equal(watchdogEnqueuedCount, 1);
assert.equal(failedCount, 0);
assert.equal(refundedCount, 0);

reset(2);
generationRecord.createdAt = new Date(Date.now() - 41 * 60 * 1_000).toISOString();
generationRecord.updatedAt = generationRecord.createdAt;
await processProjectGenerationWatchdog({
  operation: "watchdog",
  requestId: "request-1",
  userId: "user-1",
  billingReservationKey: "reservation-1"
});
assert.equal(enqueued.length, 0);
assert.equal(failedCount, 1);
assert.equal(refundedCount, 1);

reset(1);
generationRecord.projectId = undefined;
generationRecord.createdAt = new Date(Date.now() - 16 * 60 * 1_000).toISOString();
generationRecord.updatedAt = generationRecord.createdAt;
await processProjectGenerationWatchdog({
  operation: "watchdog",
  requestId: "request-1",
  userId: "user-1",
  billingReservationKey: "reservation-1"
});
assert.equal(failedCount, 1);
assert.equal(refundedCount, 1);

console.log("Background media orchestration integration smoke checks passed.");
