import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/edit-plan-preview-assets.ts", import.meta.url), "utf8");
const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require: () => ({}) });
const { editPlanVisualSceneNumbers, planPreviewAsset, promoteEditPlanPreviewAssets, removeEditPlanPreviewAssets } = module.exports;

const plan = {
  id: "plan-current",
  changes: [
    { sceneNumber: 1, status: "updated", regenerate: ["image", "audio"] },
    { sceneNumber: 2, status: "updated", regenerate: ["audio"] },
    { sceneNumber: 3, status: "deleted", regenerate: ["image"] }
  ]
};
assert.deepEqual(Array.from(editPlanVisualSceneNumbers(plan)), [1]);

const current = { id: "current", type: "image", r2Key: "current.png", url: "/current.png" };
const clip = { id: "clip", type: "clip", r2Key: "clip.mp4", url: "/clip.mp4" };
const unrelated = {
  id: "unrelated",
  type: "thumbnail",
  r2Key: "unrelated.png",
  url: "/unrelated.png",
  metadata: { candidate: true, planPreview: true, editPlanId: "plan-old" }
};
const preview = {
  id: "preview",
  type: "thumbnail",
  r2Key: "preview.png",
  url: "/preview.png",
  metadata: { candidate: true, planPreview: true, editPlanId: "plan-current" }
};
const scene = { id: "scene", sceneNumber: 1, assets: [current, clip, unrelated, preview] };
assert.equal(planPreviewAsset(scene, "plan-current").id, "preview");
assert.equal(planPreviewAsset(scene, "missing"), undefined);

const project = { currentVersion: { scenes: [scene] } };
const promoted = promoteEditPlanPreviewAssets(project, plan);
assert.deepEqual(Array.from(promoted.adoptedSceneNumbers), [1]);
const assets = promoted.project.currentVersion.scenes[0].assets;
assert.equal(assets[0].type, "image");
assert.equal(assets[0].r2Key, "preview.png");
assert.equal(assets[0].metadata.candidate, false);
assert.equal(assets.some((asset) => asset.id === "current" || asset.id === "clip"), false);
assert.equal(assets.some((asset) => asset.id === "unrelated"), true);
const removed = removeEditPlanPreviewAssets(project, "plan-current");
assert.equal(removed.currentVersion.scenes[0].assets.some((asset) => asset.id === "preview"), false);
assert.equal(removed.currentVersion.scenes[0].assets.some((asset) => asset.id === "unrelated"), true);

assert.match(workspace, /function scenePreviewAsset/);
assert.match(workspace, /asset\.type === "thumbnail"[\s\S]*asset\.metadata\?\.candidate !== true[\s\S]*asset\.metadata\?\.planPreview !== true/);
assert.match(workspace, /const image = scenePreviewAsset\(scene\);[\s\S]*kv-board-image/);
assert.match(workspace, /const canShowDraftTextPreview = Boolean\(!preview && image && titleChanged\)/);
assert.match(workspace, /kv-plan-preview-ready draft/);
assert.match(styles, /\.kv-plan-frame\.text-preview::before/);
assert.match(styles, /\.kv-plan-preview-ready\.draft/);

console.log("Edit plan visual preview smoke checks passed.");
