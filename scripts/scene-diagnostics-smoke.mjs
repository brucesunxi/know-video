import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const diagnostics = fs.readFileSync(new URL("../lib/scene-diagnostics.ts", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../app/api/edit-plan/route.ts", import.meta.url), "utf8");
const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");

assert.match(diagnostics, /isReadOnlySceneDiagnosticRequest/);
assert.match(diagnostics, /怎么\(\?:了\|回事\)/);
assert.match(diagnostics, /qualityFallback/);
assert.match(diagnostics, /本次检查没有修改场景，也没有创建新版本/);
assert.match(route, /action: "scene-diagnostic"/);
assert.match(route, /persistReadOnlyConversation/);
assert.match(route, /isReadOnlySceneDiagnosticRequest\(body\.request\)/);
assert.match(workspace, /case "diagnosing-scene"/);
assert.match(workspace, /data\.action === "scene-diagnostic"/);

const output = ts.transpileModule(diagnostics, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, {
  module,
  exports: module.exports,
  require: (specifier) => {
    if (specifier === "@/lib/edit-intent") return { extractRequestedSceneNumbers: () => [5] };
    if (specifier === "@/lib/generation-resume") return {
      isDeliverableVisualAsset: (asset) => asset.metadata?.qualityFallback !== true,
      sceneHasAudioAsset: (scene) => scene.assets.some((asset) => asset.type === "audio"),
      sceneHasVisualAsset: (scene) => scene.assets.some((asset) => asset.type === "image" && asset.metadata?.qualityFallback !== true)
    };
    return {};
  }
});
const { isReadOnlySceneDiagnosticRequest } = module.exports;
assert.equal(isReadOnlySceneDiagnosticRequest("第五个场景怎么了呢？检查一下吧"), true);
assert.equal(isReadOnlySceneDiagnosticRequest("为什么第五个场景没有生成，帮我检查一下"), true);
assert.equal(isReadOnlySceneDiagnosticRequest("请重新生成第五个场景并检查一下"), false);
assert.equal(isReadOnlySceneDiagnosticRequest("Please regenerate scene 5 and check it"), false);

console.log("Read-only scene diagnostic smoke checks passed.");
