import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/generation-resume.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require: () => ({}) });
const { mediaAssetStatus, missingMotionSceneNumbers, missingSceneAssetNumbers, sceneHasAudioAsset, sceneHasVisualAsset } = module.exports;

const scenes = [
  { sceneNumber: 1, assets: [{ type: "image", url: "image-1" }, { type: "audio", url: "audio-1" }, { type: "clip", url: "clip-1" }] },
  { sceneNumber: 2, assets: [{ type: "image", url: "image-2" }] },
  { sceneNumber: 3, assets: [{ type: "audio", url: "audio-3" }] },
  { sceneNumber: 4, assets: [{ type: "image", url: "" }, { type: "audio", url: "" }, { type: "clip", url: "" }] }
];

assert.deepEqual(Array.from(missingSceneAssetNumbers(scenes, "image")), [3, 4]);
assert.deepEqual(Array.from(missingSceneAssetNumbers(scenes, "audio")), [2, 4]);
assert.deepEqual(Array.from(missingMotionSceneNumbers(scenes, [1, 2, 4])), [2, 4]);
assert.deepEqual(Array.from(missingMotionSceneNumbers(scenes, [1])), []);
assert.equal(sceneHasVisualAsset(scenes[0]), true);
assert.equal(sceneHasAudioAsset(scenes[1]), false);
assert.equal(mediaAssetStatus(scenes), "partial");
assert.equal(mediaAssetStatus([scenes[0]]), "ready");
assert.equal(mediaAssetStatus([{ sceneNumber: 5, assets: [] }]), "failed");

console.log("Generation resume smoke checks passed.");
