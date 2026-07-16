import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/edit-plan-normalizer.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require: () => ({}) });
const { normalizeEditPlanAgainstScenes } = module.exports;

const scene = {
  id: "scene-1",
  sceneNumber: 1,
  title: "Original",
  voiceover: "Original narration",
  visualPrompt: "Original visual",
  motionPrompt: "Original motion",
  durationSeconds: 5,
  style: { theme: "dark", palette: ["#000", "#fff"], mood: "focused" },
  assets: []
};
const basePlan = {
  id: "plan-1",
  editNumber: 1,
  baseVersionId: "version-1",
  status: "proposed",
  userRequest: "test",
  summary: "test",
  affectedScenes: [1],
  changes: [],
  createdAt: new Date(0).toISOString()
};
const side = {
  title: scene.title,
  voiceover: scene.voiceover,
  thumbnailTone: "dark",
  visualPrompt: scene.visualPrompt,
  motionPrompt: scene.motionPrompt
};

const visual = normalizeEditPlanAgainstScenes({
  ...basePlan,
  changes: [{
    sceneNumber: 1,
    status: "updated",
    before: { ...side, visualPrompt: "Untrusted before value" },
    after: { ...side, visualPrompt: "New visual" },
    regenerate: ["audio"]
  }]
}, [scene]);
assert.deepEqual(Array.from(visual.changes[0].regenerate), ["image", "thumbnail", "render"]);
assert.equal(visual.changes[0].before.visualPrompt, scene.visualPrompt);

const narration = normalizeEditPlanAgainstScenes({
  ...basePlan,
  changes: [{
    sceneNumber: 1,
    status: "updated",
    before: side,
    after: { ...side, voiceover: "New narration" },
    regenerate: []
  }]
}, [scene]);
assert.deepEqual(Array.from(narration.changes[0].regenerate), ["audio", "caption", "render"]);

const unchanged = normalizeEditPlanAgainstScenes({
  ...basePlan,
  affectedScenes: [1, 99],
  changes: [
    { sceneNumber: 1, status: "updated", before: side, after: side, regenerate: ["image", "audio"] },
    { sceneNumber: 99, status: "updated", before: side, after: side, regenerate: ["image"] }
  ]
}, [scene]);
assert.deepEqual(Array.from(unchanged.affectedScenes), []);
assert.deepEqual(Array.from(unchanged.changes), []);

console.log("Edit plan normalization smoke checks passed.");
