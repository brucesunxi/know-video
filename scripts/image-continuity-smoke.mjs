import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/image-continuity.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports });
const { projectVisualIdentity, sceneImagePrompt, stableImageSeed } = module.exports;

const scene = {
  id: "scene-1",
  sceneNumber: 1,
  title: "Creator at work",
  voiceover: "A creator begins.",
  visualPrompt: [
    "A creator works at a translucent console.",
    "Shared visual world: a precise glass-and-aluminum studio",
    "Art direction: restrained commercial realism",
    "Lighting: cool window light with a warm practical",
    "Recurring motif: a thin cyan light ribbon"
  ].join("\n"),
  motionPrompt: "Camera pushes in slowly",
  durationSeconds: 5,
  style: { theme: "cinematic", palette: ["#07111d", "#22c7b8", "#f5c46b"], mood: "focused" },
  assets: []
};
const project = {
  id: "project-stable",
  title: "Visual Continuity",
  engine: "Animation Engine",
  credits: 0,
  plan: "Free",
  currentVersion: {
    id: "version-a",
    label: "draft",
    status: "draft",
    createdAt: new Date(0).toISOString(),
    durationSeconds: 5,
    scenes: [scene]
  }
};

assert.equal(stableImageSeed("project-stable:1"), stableImageSeed("project-stable:1"));
assert.notEqual(stableImageSeed("project-stable:1"), stableImageSeed("project-stable:2"));
assert.match(projectVisualIdentity(project), /thin cyan light ribbon/);
assert.match(projectVisualIdentity(project), /Locked palette: #07111d, #22c7b8, #f5c46b/);

const prompt = sceneImagePrompt(scene, project, ["current", "anchor"]);
assert.match(prompt, /current version of this exact scene/);
assert.match(prompt, /project's visual anchor/);
assert.match(prompt, /identity and art direction are locked/);
assert.match(prompt, /Use little or no text/);

console.log("Image continuity smoke checks passed.");
