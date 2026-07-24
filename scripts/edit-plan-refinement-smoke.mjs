import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/edit-plan-refinement.ts", import.meta.url), "utf8");
const aiVideo = fs.readFileSync(new URL("../lib/ai-video.ts", import.meta.url), "utf8");
const compilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 };
const output = ts.transpileModule(source, {
  compilerOptions
}).outputText;
const intentSource = fs.readFileSync(new URL("../lib/edit-intent.ts", import.meta.url), "utf8");
const intentModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(intentSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, { module: intentModule, exports: intentModule.exports });
const module = { exports: {} };
vm.runInNewContext(output, {
  module,
  exports: module.exports,
  crypto: { randomUUID: () => "refined-plan" },
  require: (specifier) => {
    if (specifier === "@/lib/edit-intent") return intentModule.exports;
    if (specifier === "@/lib/edit-operations") {
      return {
        editPlanOperations: (plan) => plan.operations ?? (plan.sceneStructure ? [plan.sceneStructure] : [])
      };
    }
    return {};
  }
});
const { refineEditPlanScope } = module.exports;

const scenes = [1, 2, 3, 4].map((sceneNumber) => ({ sceneNumber }));
const changes = scenes.map(({ sceneNumber }) => ({ sceneNumber, status: "updated" }));
const existingPlan = {
  id: "original-plan",
  editNumber: 1,
  baseVersionId: "version-1",
  status: "proposed",
  userRequest: "把所有场景改成明亮风格",
  summary: "全部改为明亮风格",
  affectedScenes: [1, 2, 3, 4],
  changes,
  createdAt: new Date(0).toISOString()
};
const version = { id: "version-1", scenes };

const excluded = refineEditPlanScope({
  request: "第 3 场保持不变",
  version,
  existingPlan,
  editNumber: 2
});
assert.deepEqual(Array.from(excluded.affectedScenes), [1, 2, 4]);
assert.equal(excluded.id, "refined-plan");
assert.match(excluded.summary, /场景 3 保持不变/);

const selected = refineEditPlanScope({
  request: "只修改第 2、4 场",
  version,
  existingPlan,
  editNumber: 3
});
assert.deepEqual(Array.from(selected.affectedScenes), [2, 4]);
assert.match(selected.summary, /仅保留场景 2、4/);

assert.equal(refineEditPlanScope({
  request: "第 2 场再亮一点",
  version,
  existingPlan,
  editNumber: 4
}), undefined);

assert.equal(refineEditPlanScope({
  request: "第 3 场保持不变，但第 4 场再亮一点",
  version,
  existingPlan,
  editNumber: 5
}), undefined);

assert.match(aiVideo, /const requestedProductionSettings = conversationProgram\.productionSettings[\s\S]*\?\? productionSettingsFromRequest\(params\.request\)/);
assert.match(aiVideo, /productionSettings: \{[\s\S]*\.\.\.params\.existingPlan\.productionSettings,[\s\S]*\.\.\.requestedProductionSettings/);

console.log("Edit plan refinement smoke checks passed.");
