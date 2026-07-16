import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/project-creation.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require: () => ({}) });
const { initialVersionStatus, materializeNewProject } = module.exports;

const image = { id: "old-image", type: "image", r2Key: "image", url: "/image" };
const audio = { id: "old-audio", type: "audio", r2Key: "audio", url: "/audio" };
const render = { id: "old-render", type: "render", r2Key: "render", url: "/render" };
const scene = {
  id: "old-scene",
  sceneNumber: 1,
  title: "标题",
  voiceover: "旁白",
  visualPrompt: "画面",
  motionPrompt: "运动",
  durationSeconds: 5,
  style: { theme: "dark", palette: ["#000000"], mood: "focused" },
  assets: [image, audio, render]
};
const project = {
  id: "old-project",
  title: "项目",
  engine: "Animation Engine",
  credits: 0,
  plan: "Free",
  currentVersion: {
    id: "old-version",
    label: "draft",
    status: "planning",
    createdAt: new Date(0).toISOString(),
    durationSeconds: 5,
    scenes: [scene]
  }
};

assert.equal(initialVersionStatus({ ...project, currentVersion: { ...project.currentVersion, scenes: [] } }), "failed");
assert.equal(initialVersionStatus({
  ...project,
  currentVersion: {
    ...project.currentVersion,
    scenes: [{ ...scene, assets: [image] }]
  }
}), "draft");
assert.equal(initialVersionStatus(project), "ready");

let id = 0;
const materialized = materializeNewProject(project, () => `id-${++id}`);
assert.equal(materialized.projectId, "id-1");
assert.equal(materialized.versionId, "id-2");
assert.notEqual(materialized.scenes[0].id, scene.id);
assert.deepEqual(
  Array.from(materialized.scenes[0].assets).map((asset) => asset.type),
  ["image", "audio"]
);
assert.ok(materialized.scenes[0].assets.every((asset) => asset.id.startsWith("id-")));

console.log("Project creation smoke checks passed.");
