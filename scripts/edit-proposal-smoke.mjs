import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/edit-proposal.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require: () => ({}) });
const { materializeEditProposal } = module.exports;

const sourcePlan = {
  id: "temporary",
  editNumber: 2,
  baseVersionId: "old-version",
  status: "proposed",
  userRequest: "把全片改成中文",
  summary: "中文化",
  affectedScenes: [1, 2],
  changes: [],
  createdAt: new Date(0).toISOString()
};

let id = 0;
const materialized = materializeEditProposal(sourcePlan, "current-version", () => `id-${++id}`);
assert.equal(materialized.planId, "id-1");
assert.equal(materialized.userMessageId, "id-2");
assert.equal(materialized.assistantMessageId, "id-3");
assert.equal(materialized.editPlan.id, materialized.planId);
assert.equal(materialized.editPlan.baseVersionId, "current-version");
assert.equal(materialized.editPlan.status, "proposed");
assert.equal(sourcePlan.baseVersionId, "old-version");

console.log("Edit proposal smoke checks passed.");
