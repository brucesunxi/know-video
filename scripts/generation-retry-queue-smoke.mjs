import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

const route = fs.readFileSync(new URL("../app/api/projects/generation/route.ts", import.meta.url), "utf8");
const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");

assert.match(route, /export async function POST\(request: Request\)/);
assert.match(route, /failedRequestId: z\.string\(\)\.uuid\(\)/);
assert.match(route, /retryRequestId: z\.string\(\)\.uuid\(\)/);
assert.match(route, /failed\.status !== "failed" \|\| !failed\.projectId/);
assert.match(route, /retryEstimateItems\(scenes\)/);
assert.match(route, /resourceType: "image_standard"/);
assert.match(route, /resourceType: "speech"/);
assert.match(route, /reserveCredits\(\{/);
assert.match(route, /reserveAdditionalCredits\(\{/);
assert.match(route, /attachGenerationRequestProject\(\{/);
assert.match(route, /enqueueProjectGenerationWatchdog\(\{/);
assert.match(route, /enqueueProjectMediaScene\(\{/);
assert.match(route, /sceneNumber: firstIncomplete\.sceneNumber/);
assert.match(route, /deleteFailedGenerationRequest\(failedRequestId, user\.id\)/);
assert.match(route, /project_media_retry_start_failed/);
assert.match(route, /failGenerationRequest\(\{/);
assert.match(route, /INSUFFICIENT_CREDITS/);

const openProject = workspace.slice(
  workspace.indexOf("async function openProject("),
  workspace.indexOf("async function renameProject(")
);
assert.match(openProject, /fetch\("\/api\/projects\/generation", \{/);
assert.match(openProject, /failedRequestId: failedGenerationTaskId/);
assert.match(openProject, /retryRequestId: crypto\.randomUUID\(\)/);
assert.match(openProject, /await openProjects\(\)/);
assert.doesNotMatch(openProject, /\/api\/assets\/generate/);
assert.doesNotMatch(openProject, /\/api\/assets\/audio\/generate/);
assert.doesNotMatch(openProject, /continueGeneratedProject/);

class InsufficientCreditsError extends Error {
  constructor(availableCredits, requiredCredits) {
    super(`Credits 不足：需要 ${requiredCredits}，当前可用 ${availableCredits}。`);
    this.availableCredits = availableCredits;
    this.requiredCredits = requiredCredits;
  }
}

const scenes = Array.from({ length: 5 }, (_, index) => ({
  id: `scene-${index + 1}`,
  sceneNumber: index + 1,
  title: `Scene ${index + 1}`,
  voiceover: `Narration ${index + 1}`,
  visualPrompt: `Visual ${index + 1}`,
  durationSeconds: index === 4 ? 4 : 6,
  style: {},
  assets: [
    ...(index === 0 ? [] : [{ type: "image", url: `/scene-${index + 1}.png` }]),
    ...(index === 4 ? [] : [{ type: "audio", url: `/scene-${index + 1}.wav` }])
  ]
}));
const snapshot = {
  project: {
    id: "project-1",
    title: "Project",
    currentVersion: { id: "version-1", scenes }
  },
  messages: []
};
const failedRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "failed",
  projectId: "project-1",
  prompt: "Create a video",
  engine: "ai",
  options: { motion: "camera", language: "中文" },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};
let reserveFailure = false;
let reservedInput;
let premiumInput;
let attachedInput;
let watchdogInput;
let sceneMessage;
let deletedInput;
let failedInput;

const compiled = ts.transpileModule(route, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, {
  module,
  exports: module.exports,
  Request,
  Response,
  URL,
  Date,
  console: { error() {}, warn() {} },
  require: (id) => {
    if (id === "next/server") return {
      NextResponse: {
        json: (payload, init = {}) => new Response(JSON.stringify(payload), {
          status: init.status ?? 200,
          headers: { "content-type": "application/json" }
        })
      }
    };
    if (id === "zod") return { z };
    if (id === "@/lib/auth") return {
      authRequiredResponse: () => new Response(null, { status: 401 }),
      requireCurrentUser: async () => ({ id: "user-1" })
    };
    if (id === "@/lib/generation-requests") return {
      attachGenerationRequestProject: async (input) => { attachedInput = input; },
      claimGenerationRequest: async () => ({ claimed: true }),
      deleteFailedGenerationRequest: async (idValue, userId) => {
        deletedInput = { id: idValue, userId };
        return true;
      },
      failGenerationRequest: async (input) => { failedInput = input; },
      generationRequestFingerprint: () => "fingerprint",
      getGenerationRequest: async () => undefined,
      getGenerationRequestBeforeExpiry: async () => failedRecord,
      listCompletedPendingGenerationRequests: async () => [],
      listIncompleteGenerationRequests: async () => []
    };
    if (id === "@/lib/generation-reconciliation") return {
      reconcileCompletedGenerationRequest: async (value) => value,
      reconcileCompletedGenerationRequests: async () => undefined,
      recoverStalledGenerationRequest: async (value) => value,
      recoverStalledGenerationRequests: async (value) => value
    };
    if (id === "@/lib/media-generation-queue") return {
      enqueueProjectGenerationWatchdog: async (input) => { watchdogInput = input; },
      enqueueProjectMediaScene: async (input) => { sceneMessage = input; }
    };
    if (id === "@/lib/project-store") return { getProjectSnapshot: async () => structuredClone(snapshot) };
    if (id === "@/lib/billing/usage") return {
      InsufficientCreditsError,
      reserveAdditionalCredits: async (input) => { premiumInput = input; },
      reserveCredits: async (input) => {
        reservedInput = input;
        if (reserveFailure) throw new InsufficientCreditsError(2, 15);
        return { estimate: { maximumCredits: 15 } };
      }
    };
    if (id === "@/lib/billing/estimate") return {
      estimateBilling: (items) => items[0].resourceType === "image_premium"
        ? { maximumCredits: 20, estimatedProviderCostUsd: 0.02 }
        : { maximumCredits: 10, estimatedProviderCostUsd: 0.01 }
    };
    if (id === "@/lib/image-continuity") return {
      sceneRequiresPremiumImage: (scene) => scene.sceneNumber === 1
    };
    if (id === "@/lib/generation-resume") return {
      sceneHasAudioAsset: (scene) => scene.assets.some((asset) => asset.type === "audio" && asset.url),
      sceneHasVisualAsset: (scene) => scene.assets.some((asset) => ["image", "clip"].includes(asset.type) && asset.url)
    };
    throw new Error(`Unexpected import: ${id}`);
  }
});

const { POST } = module.exports;
const failedRequestId = failedRecord.id;
const retryRequestId = "22222222-2222-4222-8222-222222222222";
const response = await POST(new Request("https://example.test/api/projects/generation", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ failedRequestId, retryRequestId })
}));
assert.equal(response.status, 202);
assert.equal(
  JSON.stringify(reservedInput.items.map((item) => [item.resourceType, item.quantity])),
  JSON.stringify([["image_standard", 1], ["speech", 5]])
);
assert.equal(premiumInput.adjustmentKey, `${retryRequestId}:scene:1:premium-upgrade`);
assert.equal(attachedInput.projectId, "project-1");
assert.equal(watchdogInput.requestId, retryRequestId);
assert.equal(sceneMessage.sceneNumber, 1);
assert.equal(sceneMessage.versionId, "version-1");
assert.equal(deletedInput.id, failedRequestId);
assert.equal(deletedInput.userId, "user-1");
assert.equal(failedInput, undefined);

reserveFailure = true;
failedInput = undefined;
const insufficient = await POST(new Request("https://example.test/api/projects/generation", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    failedRequestId,
    retryRequestId: "33333333-3333-4333-8333-333333333333"
  })
}));
assert.equal(insufficient.status, 402);
assert.equal((await insufficient.json()).code, "INSUFFICIENT_CREDITS");
assert.equal(failedInput.refundReason, "project_media_retry_start_failed");

console.log("Failed project background retry smoke checks passed.");
