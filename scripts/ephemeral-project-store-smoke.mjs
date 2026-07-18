import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/ephemeral-project-store.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, {
  module,
  exports: module.exports,
  require: (specifier) => specifier === "@/lib/generation-resume"
    ? { mediaAssetStatus: (scenes) => scenes.every((scene) => scene.assets.some((asset) => ["image", "clip"].includes(asset.type) && asset.url) && scene.assets.some((asset) => asset.type === "audio" && asset.url)) ? "ready" : "partial" }
    : {}
});
const { getEphemeralProject, listEphemeralProjects, saveEphemeralProject, updateEphemeralVersionScenes } = module.exports;

const project = {
  id: "project-live-preview",
  title: "Local project",
  currentVersion: {
    id: "version-1",
    status: "planning",
    durationSeconds: 10,
    scenes: [1, 2].map((sceneNumber) => ({
      id: `scene-${sceneNumber}`,
      sceneNumber,
      style: {},
      assets: []
    }))
  }
};
saveEphemeralProject(project, { messages: [] });
assert.equal(getEphemeralProject(project.id, "version-1").project.id, project.id);
assert.equal(getEphemeralProject(project.id, "wrong-version"), undefined);

const scenes = project.currentVersion.scenes.map((scene) => ({
  ...scene,
  assets: [
    { id: `image-${scene.sceneNumber}`, type: "image", r2Key: `image-${scene.sceneNumber}`, url: `/image-${scene.sceneNumber}.png` },
    { id: `audio-${scene.sceneNumber}`, type: "audio", r2Key: `audio-${scene.sceneNumber}`, url: `/audio-${scene.sceneNumber}.wav` }
  ]
}));
updateEphemeralVersionScenes("version-1", scenes);
const updated = getEphemeralProject(project.id, "version-1").project;
assert.equal(updated.currentVersion.status, "ready");
assert.equal(updated.currentVersion.assetStatus, "ready");
assert.equal(listEphemeralProjects()[0].visualCount, 2);
assert.equal(listEphemeralProjects()[0].audioCount, 2);

console.log("Ephemeral project store smoke checks passed.");
