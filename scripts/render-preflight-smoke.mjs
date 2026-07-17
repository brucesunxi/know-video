import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/render-preflight.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require: () => ({}) });
const { renderInputAssets, renderInputMetadataIssue } = module.exports;

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
assert.equal(renderInputMetadataIssue(inputs[0], { contentLength: 50_000, contentType: "video/mp4" }), undefined);
assert.match(renderInputMetadataIssue(inputs[0], { contentLength: 50_000, contentType: "image/png" }), /视频/);
assert.equal(renderInputMetadataIssue(inputs[1], { contentLength: 20_000, contentType: "audio/wav" }), undefined);
assert.match(renderInputMetadataIssue(inputs[1], { contentLength: 900, contentType: "audio/wav" }), /大小/);

console.log("Render input preflight smoke checks passed.");
