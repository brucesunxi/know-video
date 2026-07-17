import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/scene-transitions.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require: () => ({}) });
const { boundedTransitionFrames, resolvedSceneTransition } = module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

const base = {
  sceneNumber: 2,
  motionPrompt: "Camera pushes in toward the subject",
  style: { theme: "dark", palette: ["#000", "#fff"], mood: "focused" }
};

assert.deepEqual(plain(resolvedSceneTransition(base)), { kind: "zoom", durationSeconds: 0.5 });
assert.deepEqual(plain(resolvedSceneTransition({ ...base, style: { ...base.style, transition: { kind: "wipe", durationSeconds: 0.75 } } })), { kind: "wipe", durationSeconds: 0.75 });
assert.deepEqual(plain(resolvedSceneTransition({ ...base, style: { ...base.style, transition: { kind: "cut", durationSeconds: 1 } } })), { kind: "cut", durationSeconds: 0 });
assert.equal(boundedTransitionFrames({ scene: base, fps: 30, previousSceneFrames: 180, sceneFrames: 180 }), 15);
assert.equal(boundedTransitionFrames({ scene: { ...base, style: { ...base.style, transition: { kind: "dissolve", durationSeconds: 1 } } }, fps: 30, previousSceneFrames: 30, sceneFrames: 24 }), 8);
assert.equal(boundedTransitionFrames({ scene: { ...base, style: { ...base.style, transition: { kind: "cut", durationSeconds: 0 } } }, fps: 30, previousSceneFrames: 180, sceneFrames: 180 }), 0);

console.log("Scene transition smoke checks passed.");
