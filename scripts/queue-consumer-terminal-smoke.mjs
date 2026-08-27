import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../app/api/queues/project-media/route.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

class ProjectMediaQualityExhaustedError extends Error {}
let renderFailure;
let generationFailure;
let sceneFailure;
let terminalRenderCalls = 0;
let terminalGenerationCalls = 0;
let terminalSceneCalls = 0;
let terminalGenerationError;
let terminalGenerationFailure;

const module = { exports: {} };
vm.runInNewContext(output, {
  module,
  exports: module.exports,
  console: { ...console, error: () => undefined },
  require: (id) => {
    if (id === "@vercel/queue") {
      return { handleCallback: (handler) => handler };
    }
    if (id.includes("background-media-generation")) {
      return {
        ProjectMediaQualityExhaustedError,
        processProjectMediaScene: async () => { if (sceneFailure) throw sceneFailure; },
        processProjectGenerationWatchdog: async () => { if (generationFailure) throw generationFailure; },
        permanentlyFailProjectMedia: async () => { terminalSceneCalls += 1; },
        permanentlyFailProjectGenerationWatchdog: async (_message, error) => {
          terminalGenerationCalls += 1;
          terminalGenerationError = error;
          if (terminalGenerationFailure) throw terminalGenerationFailure;
        }
      };
    }
    if (id.includes("background-recovery-policy")) {
      return { MAX_PROJECT_MEDIA_RECOVERY_PASSES: 1 };
    }
    if (id.includes("render-watchdog")) {
      return {
        processRenderJobWatchdog: async () => { if (renderFailure) throw renderFailure; },
        permanentlyFailRenderWatchdog: async () => { terminalRenderCalls += 1; }
      };
    }
    return {};
  }
});

const consume = module.exports.POST;
const renderMessage = { operation: "render-watchdog", jobId: "job-1", projectId: "project-1", versionId: "version-1" };
const generationMessage = { operation: "watchdog", requestId: "request-1", userId: "user-1" };
const sceneMessage = { operation: "scene", requestId: "request-1", userId: "user-1", projectId: "project-1", versionId: "version-1", sceneNumber: 2 };

renderFailure = new Error("render watchdog failed");
await assert.rejects(() => consume(renderMessage, { deliveryCount: 2 }), /render watchdog failed/);
assert.equal(terminalRenderCalls, 0);
await consume(renderMessage, { deliveryCount: 3 });
assert.equal(terminalRenderCalls, 1);

generationFailure = new Error("generation watchdog failed");
await assert.rejects(() => consume(generationMessage, { deliveryCount: 2 }), /generation watchdog failed/);
assert.equal(terminalGenerationCalls, 0);
await consume(generationMessage, { deliveryCount: 3 });
assert.equal(terminalGenerationCalls, 1);
assert.equal(terminalGenerationError, generationFailure);

terminalGenerationFailure = new Error("terminal database write failed");
await assert.rejects(() => consume(generationMessage, { deliveryCount: 4 }), /terminal database write failed/);
terminalGenerationFailure = undefined;

sceneFailure = new ProjectMediaQualityExhaustedError("quality exhausted");
await consume(sceneMessage, { deliveryCount: 2 });
assert.equal(terminalSceneCalls, 1);
sceneFailure = new Error("provider unavailable");
await consume(sceneMessage, { deliveryCount: 3 });
assert.equal(terminalSceneCalls, 2);

console.log("Queue consumer terminal-state smoke checks passed.");
