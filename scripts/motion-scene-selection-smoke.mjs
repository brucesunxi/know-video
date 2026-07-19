import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/motion-scene-selection.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require: () => ({}) });
const { motionSceneLimit, motionSceneScore, selectMotionCriticalScenes } = module.exports;

const image = (number) => ({ id: `image-${number}`, type: "image", url: `/scene-${number}.png`, r2Key: `scene-${number}` });
const scene = (sceneNumber, title, motionPrompt, withImage = true) => ({
  id: `scene-${sceneNumber}`,
  sceneNumber,
  title,
  voiceover: title,
  visualPrompt: `${title} cinematic environment with layered foreground, midground, and background.`,
  motionPrompt,
  durationSeconds: 6,
  style: { theme: "cinematic", palette: ["#000000"], mood: "focused" },
  assets: withImage ? [image(sceneNumber)] : []
});

const scenes = [
  scene(1, "Opening", "A static locked shot introduces the title."),
  scene(2, "Transformation", "Camera pushes in as components burst apart, orbit, rotate, and assemble into a new product."),
  scene(3, "Detail", "Slow camera pan across a still product surface."),
  scene(4, "Momentum", "Tracking camera follows the subject as light flows, cards sweep forward, and particles rise."),
  scene(5, "Final logo", "Static end card and final logo lockup.")
];

assert.equal(motionSceneLimit(30, 5), 1);
assert.equal(motionSceneLimit(45, 5), 1);
assert.ok(motionSceneScore(scenes[1], scenes.length) > motionSceneScore(scenes[4], scenes.length));
assert.deepEqual(Array.from(selectMotionCriticalScenes(scenes, 30)), [2]);
assert.deepEqual(Array.from(selectMotionCriticalScenes(scenes, 60)), [2]);
assert.deepEqual(Array.from(selectMotionCriticalScenes(scenes.map((item, index) => index === 1 ? { ...item, assets: [] } : item), 30)), [4]);

console.log("Motion scene selection smoke checks passed.");
