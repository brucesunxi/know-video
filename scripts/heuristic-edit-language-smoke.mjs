import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/video-brain.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
const localRequire = (name) => {
  if (name === "@/lib/edit-intent") return {
    analyzeEditIntent: () => ({ explicitSceneNumbers: [2], global: false }),
    requestsGeneratedClip: () => false
  };
  if (name === "@/lib/voice-profiles") return { narrationVoiceFromRequest: () => undefined };
  if (name === "@/lib/production-edit-intent") return {
    isProductionOnlyRequest: () => false,
    productionSettingsFromRequest: () => ({})
  };
  throw new Error(`Unexpected import: ${name}`);
};
vm.runInNewContext(output, { module, exports: module.exports, require: localRequire, crypto: { randomUUID } });
const { buildEditPlanFromRequest } = module.exports;
const version = {
  id: "version",
  label: "current",
  status: "ready",
  createdAt: new Date(0).toISOString(),
  durationSeconds: 10,
  scenes: [{
    id: "scene-1",
    sceneNumber: 1,
    title: "开场",
    voiceover: "介绍主题。",
    visualPrompt: "品牌开场",
    motionPrompt: "淡入",
    durationSeconds: 5,
    style: { theme: "dark", palette: ["#000", "#fff"], mood: "focused" },
    assets: []
  }, {
    id: "scene-2",
    sceneNumber: 2,
    title: "产品能力",
    voiceover: "展示产品能力。",
    visualPrompt: "深色产品界面",
    motionPrompt: "缓慢推进",
    durationSeconds: 5,
    style: { theme: "dark", palette: ["#000", "#fff"], mood: "focused" },
    assets: []
  }]
};

const plan = buildEditPlanFromRequest({ request: "把第 2 场景改成浅色", version, editNumber: 1 });
assert.match(plan.summary, /场景 2/);
assert.doesNotMatch(plan.summary, /I will update/);
assert.match(plan.changes[0].after.visualPrompt, /修改要求/);
assert.doesNotMatch(plan.changes[0].after.visualPrompt, /Revision request/);

console.log("Heuristic edit language smoke checks passed.");
