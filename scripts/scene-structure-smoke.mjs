import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/scene-structure.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports });
const { applySceneStructureMutation } = module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

let id = 0;
const createId = () => `new-${++id}`;
const scene = (sceneNumber, title) => ({
  id: `scene-${sceneNumber}`,
  sceneNumber,
  title,
  voiceover: `旁白 ${sceneNumber}`,
  visualPrompt: `画面 ${sceneNumber}`,
  motionPrompt: `运动 ${sceneNumber}`,
  durationSeconds: 5,
  style: { theme: "dark", palette: ["#000", "#fff"], mood: "calm" },
  assets: [
    { id: `image-${sceneNumber}`, type: "image", r2Key: `image-${sceneNumber}.png`, url: `https://example.com/${sceneNumber}.png` },
    { id: `audio-${sceneNumber}`, type: "audio", r2Key: `audio-${sceneNumber}.mp3`, url: `https://example.com/${sceneNumber}.mp3` }
  ]
});
const project = {
  id: "project",
  title: "Timeline",
  engine: "Animation Engine",
  credits: 0,
  plan: "Free",
  currentVersion: {
    id: "version-1",
    label: "draft",
    status: "ready",
    createdAt: new Date(0).toISOString(),
    durationSeconds: 15,
    scenes: [scene(1, "A"), scene(2, "B"), scene(3, "C")]
  }
};
project.currentVersion.scenes[0].style.production = { captionsEnabled: false, playbackRate: 1.25 };
project.currentVersion.scenes[0].assets.unshift(
  { id: "logo", type: "logo", r2Key: "logo.png", url: "https://example.com/logo.png" },
  { id: "music", type: "music", r2Key: "music.mp3", url: "https://example.com/music.mp3" }
);

const moved = applySceneStructureMutation(project, { operation: "move", sceneNumber: 1, direction: "later" }, createId);
assert.deepEqual(plain(moved.project.currentVersion.scenes.map((item) => item.title)), ["B", "A", "C"]);
assert.equal(moved.selectedSceneNumber, 2);
assert.equal(moved.project.currentVersion.scenes[0].style.production.playbackRate, 1.25);
assert.deepEqual(plain(moved.project.currentVersion.scenes.map((item) => item.assets.filter((asset) => ["logo", "music"].includes(asset.type)).length)), [2, 0, 0]);

const shortened = applySceneStructureMutation(project, { operation: "set-duration", sceneNumber: 2, durationSeconds: 3 }, createId);
assert.equal(shortened.project.currentVersion.durationSeconds, 13);
assert.equal(shortened.project.currentVersion.scenes[1].durationSeconds, 3);

const duplicated = applySceneStructureMutation(project, { operation: "duplicate", sceneNumber: 2 }, createId);
assert.deepEqual(plain(duplicated.project.currentVersion.scenes.map((item) => item.title)), ["A", "B", "B 副本", "C"]);
assert.equal(duplicated.selectedSceneNumber, 3);
assert.equal(duplicated.project.currentVersion.durationSeconds, 20);

const deleted = applySceneStructureMutation(project, { operation: "delete", sceneNumber: 1 }, createId);
assert.deepEqual(plain(deleted.project.currentVersion.scenes.map((item) => item.title)), ["B", "C"]);
assert.equal(deleted.project.currentVersion.scenes[0].style.production.captionsEnabled, false);
assert.equal(deleted.project.currentVersion.scenes[0].assets.filter((asset) => ["logo", "music"].includes(asset.type)).length, 2);

assert.throws(() => applySceneStructureMutation(project, { operation: "move", sceneNumber: 1, direction: "earlier" }, createId), /边界/);
assert.throws(() => applySceneStructureMutation({ ...project, currentVersion: { ...project.currentVersion, scenes: [project.currentVersion.scenes[0]] } }, { operation: "delete", sceneNumber: 1 }, createId), /至少需要保留/);

console.log("Scene structure smoke checks passed.");
