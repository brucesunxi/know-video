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
const watchdogModule = { exports: {} };
vm.runInNewContext(watchdogOutput, {
  module: watchdogModule,
  exports: watchdogModule.exports,
  console,
  require: (id) => {
    if (id.includes("render-lifecycle")) return { renderSandboxName: (jobId) => `sandbox:${jobId}` };
    if (id.includes("render-jobs")) return { expireRenderJobFromWatchdog: async () => expiredResult };
    if (id.includes("vercel-renderer")) return { stopRenderSandbox: async (name) => { stoppedSandbox = name; } };
    return {};
  }
});

const message = { operation: "render-watchdog", jobId: "job-1", projectId: "project-1", versionId: "version-1" };
assert.equal(await watchdogModule.exports.processRenderJobWatchdog(message), false);
assert.equal(stoppedSandbox, undefined);
expiredResult = { id: "job-1", status: "failed" };
assert.equal(await watchdogModule.exports.processRenderJobWatchdog(message), true);
assert.equal(stoppedSandbox, "sandbox:job-1");

const queue = fs.readFileSync(new URL("../lib/media-generation-queue.ts", import.meta.url), "utf8");
const jobs = fs.readFileSync(new URL("../lib/render-jobs.ts", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../app/api/render-jobs/route.ts", import.meta.url), "utf8");
const consumer = fs.readFileSync(new URL("../app/api/queues/project-media/route.ts", import.meta.url), "utf8");
assert.match(queue, /RENDER_JOB_WATCHDOG_DELAY_SECONDS = 50 \* 60/);
assert.match(queue, /operation: "render-watchdog"/);
assert.match(queue, /idempotencyKey: `\$\{message\.jobId\}:render-watchdog`/);
assert.match(queue, /delaySeconds: RENDER_JOB_WATCHDOG_DELAY_SECONDS/);
assert.match(jobs, /export async function expireRenderJobFromWatchdog/);
assert.match(jobs, /status in \('queued', 'running'\)/);
assert.match(jobs, /created_at < now\(\) - interval '48 minutes'/);
assert.match(jobs, /渲染任务超过 50 分钟仍未完成/);
assert.match(jobs, /set status = 'draft', render_url = null/);
assert.match(route, /await enqueueRenderJobWatchdog\(\{/);
assert.match(route, /await enqueueRenderJobWatchdog\([\s\S]*await startSandboxRender/);
assert.match(consumer, /message\.operation === "render-watchdog"/);
assert.match(consumer, /await processRenderJobWatchdog\(message\)/);

console.log("Render watchdog smoke checks passed.");
