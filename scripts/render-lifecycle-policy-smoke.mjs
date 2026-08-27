import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/render-lifecycle-policy.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, Date, Math, Number });

const { renderJobLooksStale } = module.exports;
const now = Date.parse("2026-08-28T12:00:00.000Z");
const job = (status, createdMinutesAgo, updatedMinutesAgo) => ({
  status,
  createdAt: new Date(now - createdMinutesAgo * 60_000).toISOString(),
  updatedAt: new Date(now - updatedMinutesAgo * 60_000).toISOString()
});

assert.equal(renderJobLooksStale(job("queued", 7, 7), now), false);
assert.equal(renderJobLooksStale(job("queued", 8, 8), now), true);
assert.equal(renderJobLooksStale(job("running", 30, 19), now), false);
assert.equal(renderJobLooksStale(job("running", 30, 20), now), true);
assert.equal(renderJobLooksStale(job("running", 50, 1), now), true);
assert.equal(renderJobLooksStale(job("ready", 90, 90), now), false);
assert.equal(renderJobLooksStale({ status: "running" }, now), false);

console.log("Render lifecycle recovery policy smoke checks passed.");
