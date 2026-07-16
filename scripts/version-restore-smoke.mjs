import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/version-restore.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require: () => ({}) });
const { assertRestorableVersion, restorableSceneAssets, restoredVersionStatus } = module.exports;

const visual = { id: "visual", type: "image", r2Key: "image", url: "/image" };
const audio = { id: "audio", type: "audio", r2Key: "audio", url: "/audio" };
const scene = {
  id: "scene",
  sceneNumber: 1,
  title: "标题",
  voiceover: "旁白",
  visualPrompt: "画面",
  motionPrompt: "运动",
  durationSeconds: 5,
  style: { theme: "dark", palette: ["#000000"], mood: "focused" },
  assets: [visual, audio]
};

assert.equal(restoredVersionStatus([]), "draft");
assert.equal(restoredVersionStatus([{ ...scene, assets: [visual] }]), "draft");
assert.equal(restoredVersionStatus([scene]), "ready");
assert.deepEqual(
  Array.from(restorableSceneAssets([
    visual,
    audio,
    { id: "render", type: "render", r2Key: "render", url: "/render" }
  ])).map((asset) => asset.type),
  ["image", "audio"]
);
assert.doesNotThrow(() => assertRestorableVersion({
  projectId: "project-a",
  targetProjectId: "project-a",
  currentVersionId: "version-current",
  targetVersionId: "version-old"
}));
assert.throws(() => assertRestorableVersion({
  projectId: "project-a",
  targetProjectId: "project-b",
  currentVersionId: "version-current",
  targetVersionId: "version-old"
}), /不属于/);
assert.throws(() => assertRestorableVersion({
  projectId: "project-a",
  targetProjectId: "project-a",
  currentVersionId: "version-current",
  targetVersionId: "version-current"
}), /不需要重复恢复/);

console.log("Version restore smoke checks passed.");
