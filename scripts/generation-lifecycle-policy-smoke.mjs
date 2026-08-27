import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const policySource = fs.readFileSync(new URL("../lib/generation-lifecycle-policy.ts", import.meta.url), "utf8");
const queue = fs.readFileSync(new URL("../lib/media-generation-queue.ts", import.meta.url), "utf8");
const reconciliation = fs.readFileSync(new URL("../lib/generation-reconciliation.ts", import.meta.url), "utf8");
const projects = fs.readFileSync(new URL("../app/api/projects/route.ts", import.meta.url), "utf8");
const generationRoute = fs.readFileSync(new URL("../app/api/projects/generation/route.ts", import.meta.url), "utf8");

const output = ts.transpileModule(policySource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const policyModule = { exports: {} };
vm.runInNewContext(output, { module: policyModule, exports: policyModule.exports, Date, Math, Number });

const {
  generationExceededRuntime,
  generationMediaIsInactive,
  generationResumeAttempt
} = policyModule.exports;
const now = Date.parse("2026-08-28T12:00:00.000Z");

assert.equal(generationMediaIsInactive(new Date(now - 7 * 60_000), now), false);
assert.equal(generationMediaIsInactive(new Date(now - 8 * 60_000), now), true);
assert.equal(generationExceededRuntime(new Date(now - 39 * 60_000), now), false);
assert.equal(generationExceededRuntime(new Date(now - 40 * 60_000), now), true);
assert.equal(generationResumeAttempt(new Date(now - 17 * 60_000), now), 2);

assert.match(queue, /resumeAttempt\?: number/);
assert.match(queue, /generation-watchdog:\$\{watchdogPass\}/);
assert.match(queue, /resume:\$\{message\.resumeAttempt \?\? 0\}/);
assert.match(reconciliation, /recoverStalledGenerationRequest/);
assert.match(reconciliation, /firstIncomplete/);
assert.match(reconciliation, /await enqueueProjectGenerationWatchdog\(\{/);
assert.match(reconciliation, /await enqueueProjectMediaScene\(\{/);
assert.match(reconciliation, /await touchGenerationRequest\(generation\.id\)/);
assert.match(reconciliation, /for \(const generation of generations\)/);
assert.doesNotMatch(reconciliation, /Promise\.all\(generations/);
assert.match(projects, /recoverStalledGenerationRequests\(generationRequests, user\.id\)/);
assert.match(projects, /const projects = await listProjects\(user\.id\)/);
assert.match(projects, /const generationRequests = await listIncompleteGenerationRequests\(user\.id\)/);
assert.doesNotMatch(projects, /\[projects, generationRequests\] = await Promise\.all/);
assert.match(generationRoute, /recoverStalledGenerationRequest\(reconciled, user\.id\)/);

console.log("Generation lifecycle recovery policy smoke checks passed.");
