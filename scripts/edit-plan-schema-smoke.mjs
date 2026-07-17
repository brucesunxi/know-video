import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL("../lib/edit-plan-schema.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require });
const { editPlanSchema } = module.exports;

const side = {
  title: "标题",
  voiceover: "旁白",
  thumbnailTone: "dark",
  visualPrompt: "完整画面方向",
  motionPrompt: "镜头缓慢推进"
};
const valid = {
  id: "plan-1",
  editNumber: 1,
  baseVersionId: "version-1",
  status: "proposed",
  userRequest: "把第一个场景改成浅色",
  summary: "更新场景 1",
  affectedScenes: [1],
  changes: [{
    sceneNumber: 1,
    status: "updated",
    before: side,
    after: { ...side, thumbnailTone: "light" },
    regenerate: ["image", "thumbnail", "render"]
  }],
  createdAt: new Date(0).toISOString()
};

assert.equal(editPlanSchema.safeParse(valid).success, true);
assert.equal(editPlanSchema.safeParse({ ...valid, changes: [] }).success, false);
assert.equal(editPlanSchema.safeParse({
  ...valid,
  affectedScenes: [],
  changes: [],
  productionSettings: { captionsEnabled: false, playbackRate: 1.25 }
}).success, true);
assert.equal(editPlanSchema.safeParse({ ...valid, affectedScenes: [], changes: [], productionSettings: {} }).success, false);
assert.equal(editPlanSchema.safeParse({
  ...valid,
  affectedScenes: [2],
  changes: [],
  sceneStructure: { operation: "duplicate", sceneNumber: 2 }
}).success, true);
assert.equal(editPlanSchema.safeParse({
  ...valid,
  affectedScenes: [2],
  changes: [],
  sceneStructure: { operation: "move-to", sceneNumber: 2, targetSceneNumber: 5 }
}).success, true);
assert.equal(editPlanSchema.safeParse({
  ...valid,
  affectedScenes: [2],
  changes: [],
  sceneStructure: { operation: "split", sceneNumber: 2 }
}).success, true);
assert.equal(editPlanSchema.safeParse({
  ...valid,
  affectedScenes: [2, 3],
  changes: [],
  sceneStructure: { operation: "merge-next", sceneNumber: 2 }
}).success, true);
assert.equal(editPlanSchema.safeParse({
  ...valid,
  affectedScenes: [2],
  changes: [],
  sceneStructure: { operation: "set-duration", sceneNumber: 2, durationSeconds: 30 }
}).success, false);
assert.equal(editPlanSchema.safeParse({
  ...valid,
  changes: [{ ...valid.changes[0], regenerate: ["unknown"] }]
}).success, false);
assert.equal(editPlanSchema.safeParse({
  ...valid,
  changes: [{ ...valid.changes[0], after: { ...side, visualPrompt: "x".repeat(8001) } }]
}).success, false);

console.log("Edit plan schema smoke checks passed.");
