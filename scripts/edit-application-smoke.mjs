import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/edit-application.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require: () => ({}) });
const { isEditApplicationConflict, materializeAppliedVersion } = module.exports;

const project = {
  id: "project",
  title: "项目",
  engine: "Animation Engine",
  credits: 0,
  plan: "Free",
  currentVersion: {
    id: "version",
    label: "edit 1",
    status: "draft",
    createdAt: new Date(0).toISOString(),
    durationSeconds: 5,
    scenes: [{
      id: "old-scene",
      sceneNumber: 1,
      title: "标题",
      voiceover: "旁白",
      visualPrompt: "画面",
      motionPrompt: "运动",
      durationSeconds: 5,
      style: { theme: "dark", palette: ["#000000"], mood: "focused" },
      assets: [
        { id: "old-image", type: "image", r2Key: "image", url: "/image" },
        { id: "old-render", type: "render", r2Key: "render", url: "/render" }
      ]
    }]
  }
};

let id = 0;
const materialized = materializeAppliedVersion(project, () => `id-${++id}`);
assert.equal(materialized.versionId, "id-1");
assert.equal(materialized.assistantMessageId, "id-2");
assert.equal(materialized.directUserMessageId, "id-3");
assert.equal(materialized.scenes[0].id, "id-4");
assert.deepEqual(
  Array.from(materialized.scenes[0].assets).map((asset) => asset.type),
  ["image"]
);
assert.equal(materialized.scenes[0].assets[0].id, "id-5");
assert.equal(isEditApplicationConflict({ code: "23503" }), true);
assert.equal(isEditApplicationConflict(new Error("duplicate key value")), true);
assert.equal(isEditApplicationConflict(new Error("network unavailable")), false);

console.log("Edit application smoke checks passed.");
