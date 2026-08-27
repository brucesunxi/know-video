import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const watchdogSource = fs.readFileSync(new URL("../lib/render-watchdog.ts", import.meta.url), "utf8");
const watchdogOutput = ts.transpileModule(watchdogSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
let expiredResult;
let stoppedSandbox;
let currentJob;
let requeuedMessage;
const watchdogModule = { exports: {} };
vm.runInNewContext(watchdogOutput, {
  module: watchdogModule,
  exports: watchdogModule.exports,
  console,
  require: (id) => {
    if (id.includes("render-lifecycle")) return { renderSandboxName: (jobId) => `sandbox:${jobId}` };
    if (id.includes("media-generation-queue")) {
      return { enqueueRenderJobWatchdog: async (message) => { requeuedMessage = message; } };
    }
    if (id.includes("render-jobs")) {
      return {
        expireRenderJobFromWatchdog: async () => expiredResult,
        getRenderJob: async () => currentJob
      };
    }
    if (id.includes("vercel-renderer")) return { stopRenderSandbox: async (name) => { stoppedSandbox = name; } };
    return {};
  }
});

const message = { operation: "render-watchdog", jobId: "job-1", projectId: "project-1", versionId: "version-1" };
assert.equal(await watchdogModule.exports.processRenderJobWatchdog(message), false);
assert.equal(stoppedSandbox, undefined);
assert.equal(requeuedMessage, undefined);
currentJob = { id: "job-1", status: "running" };
assert.equal(await watchdogModule.exports.processRenderJobWatchdog(message), false);
assert.equal(requeuedMessage.watchdogPass, 1);
currentJob = { id: "job-1", status: "ready" };
requeuedMessage = undefined;
assert.equal(await watchdogModule.exports.processRenderJobWatchdog(message), false);
assert.equal(requeuedMessage, undefined);
expiredResult = { id: "job-1", status: "failed" };
assert.equal(await watchdogModule.exports.processRenderJobWatchdog(message), true);
assert.equal(stoppedSandbox, "sandbox:job-1");

const queue = fs.readFileSync(new URL("../lib/media-generation-queue.ts", import.meta.url), "utf8");
const jobs = fs.readFileSync(new URL("../lib/render-jobs.ts", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../app/api/render-jobs/route.ts", import.meta.url), "utf8");
const consumer = fs.readFileSync(new URL("../app/api/queues/project-media/route.ts", import.meta.url), "utf8");
assert.match(queue, /operation: "render-watchdog"/);
assert.match(queue, /watchdogPass\?: number/);
assert.match(queue, /idempotencyKey: `\$\{message\.jobId\}:render-watchdog:\$\{watchdogPass\}`/);
assert.match(queue, /RENDER_JOB_WATCHDOG_INITIAL_DELAY_SECONDS/);
assert.match(queue, /RENDER_JOB_WATCHDOG_RECHECK_DELAY_SECONDS/);
assert.match(watchdogSource, /getRenderJob\(message\.jobId\)/);
assert.match(watchdogSource, /watchdogPass: \(message\.watchdogPass \?\? 0\) \+ 1/);
assert.match(jobs, /export async function expireRenderJobFromWatchdog/);
assert.match(jobs, /status in \('queued', 'running'\)/);
assert.match(jobs, /RENDER_QUEUED_TIMEOUT/);
assert.match(jobs, /RENDER_INACTIVITY_TIMEOUT/);
assert.match(jobs, /RENDER_MAX_RUNTIME/);
assert.match(jobs, /渲染任务长时间没有进展或已达到 50 分钟上限/);
assert.match(jobs, /set status = 'draft', render_url = null/);
assert.match(route, /await enqueueRenderJobWatchdog\(\{/);
assert.match(route, /await enqueueRenderJobWatchdog\([\s\S]*await startSandboxRender/);
assert.match(route, /renderJobLooksStale\(renderJob\)/);
assert.match(route, /expireRenderJobFromWatchdog\(\{/);
const watchdogIndex = route.indexOf("await enqueueRenderJobWatchdog({");
const preflightIndex = route.indexOf("await Promise.all(readiness.inputs.map");
assert.ok(watchdogIndex > 0 && watchdogIndex < preflightIndex, "Watchdog must be scheduled before storage preflight");
assert.match(consumer, /message\.operation === "render-watchdog"/);
assert.match(consumer, /await processRenderJobWatchdog\(message\)/);

console.log("Render watchdog smoke checks passed.");
