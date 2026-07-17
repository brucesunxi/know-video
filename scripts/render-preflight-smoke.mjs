import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/render-preflight.ts", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../app/api/render-jobs/route.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require: () => ({}) });
const { renderInputAssets, renderInputMetadataIssue, renderInputReadiness } = module.exports;

const project = {
  currentVersion: {
    scenes: [{
      sceneNumber: 1,
      assets: [
        { id: "image", type: "image", url: "/image", r2Key: "image.png" },
        { id: "clip", type: "clip", url: "/clip", r2Key: "clip.mp4" },
        { id: "audio", type: "audio", url: "/audio", r2Key: "audio.wav" }
      ]
    }]
  }
};
const inputs = renderInputAssets(project);
assert.equal(inputs.length, 2);
assert.equal(inputs[0].asset.type, "clip");
assert.equal(inputs[1].role, "audio");
assert.equal(renderInputReadiness(project).ready, true);
assert.equal(renderInputMetadataIssue(inputs[0], { contentLength: 50_000, contentType: "video/mp4" }), undefined);
assert.match(renderInputMetadataIssue(inputs[0], { contentLength: 50_000, contentType: "image/png" }), /视频/);
assert.equal(renderInputMetadataIssue(inputs[1], { contentLength: 20_000, contentType: "audio/wav" }), undefined);
assert.match(renderInputMetadataIssue(inputs[1], { contentLength: 900, contentType: "audio/wav" }), /大小/);

const missingAudio = {
  currentVersion: {
    scenes: [{ sceneNumber: 2, assets: [{ id: "image", type: "image", url: "/image", r2Key: "image.png" }] }]
  }
};
assert.deepEqual(Array.from(renderInputReadiness(missingAudio).missingAudio), [2]);
assert.equal(renderInputReadiness(missingAudio).ready, false);
assert.match(renderInputReadiness(missingAudio).error, /缺少配音的场景：2/);
assert.match(renderInputReadiness({ currentVersion: { scenes: [] } }).error, /还没有可渲染的场景/);
assert.match(route, /renderInputReadiness/);
assert.match(route, /const readiness = renderInputReadiness\(project\)/);
assert.match(route, /if \(!readiness\.ready\)/);
assert.match(route, /readiness\.error/);
assert.match(route, /readiness\.inputs\.map/);

console.log("Render input preflight smoke checks passed.");
