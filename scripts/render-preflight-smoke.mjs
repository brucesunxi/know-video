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
vm.runInNewContext(output, {
  module,
  exports: module.exports,
  require: (specifier) => {
    if (specifier === "@/lib/project-media-audit") {
      return {
        auditProjectMedia: (project) => ({ errors: project.qualityErrors ?? [] })
      };
    }
    if (specifier === "@/lib/production-settings") {
      return {
        productionAsset: (project, type) => project.currentVersion.scenes
          .flatMap((scene) => scene.assets)
          .find((asset) => asset.type === type && asset.url)
      };
    }
    return {};
  }
});
const { renderInputAssets, renderInputMetadataIssue, renderInputReadiness, renderProductionInputAssets } = module.exports;

const project = {
  currentVersion: {
    scenes: [{
      sceneNumber: 1,
      assets: [
        { id: "image", type: "image", url: "/image", r2Key: "image.png" },
        { id: "clip", type: "clip", url: "/clip", r2Key: "clip.mp4" },
        { id: "audio", type: "audio", url: "/audio", r2Key: "audio.wav" },
        { id: "logo", type: "logo", url: "/logo", r2Key: "logo.png" },
        { id: "music", type: "music", url: "/music", r2Key: "music.mp3" }
      ]
    }]
  }
};
const inputs = renderInputAssets(project);
assert.equal(inputs.length, 2);
assert.equal(inputs[0].asset.type, "clip");
assert.equal(inputs[1].role, "audio");
const productionInputs = renderProductionInputAssets(project);
assert.equal(productionInputs.length, 2);
assert.equal(productionInputs[0].label, "品牌 Logo");
assert.equal(productionInputs[1].asset.type, "music");
const readiness = renderInputReadiness(project);
assert.equal(readiness.ready, true);
assert.equal(readiness.inputs.length, 4);
assert.deepEqual(Array.from(readiness.qualityIssues), []);
assert.equal(renderInputMetadataIssue(inputs[0], { contentLength: 50_000, contentType: "video/mp4" }), undefined);
assert.match(renderInputMetadataIssue(inputs[0], { contentLength: 50_000, contentType: "image/png" }), /视频/);
assert.equal(renderInputMetadataIssue(inputs[1], { contentLength: 20_000, contentType: "audio/wav" }), undefined);
assert.match(renderInputMetadataIssue(inputs[1], { contentLength: 900, contentType: "audio/wav" }), /大小/);
assert.equal(renderInputMetadataIssue(productionInputs[0], { contentLength: 12_000, contentType: "image/png" }), undefined);
assert.match(renderInputMetadataIssue(productionInputs[0], { contentLength: 12_000, contentType: "audio/wav" }), /图片/);
assert.equal(renderInputMetadataIssue(productionInputs[1], { contentLength: 12_000, contentType: "audio/mpeg" }), undefined);

const missingAudio = {
  currentVersion: {
    scenes: [{ sceneNumber: 2, assets: [{ id: "image", type: "image", url: "/image", r2Key: "image.png" }] }]
  }
};
assert.deepEqual(Array.from(renderInputReadiness(missingAudio).missingAudio), [2]);
assert.equal(renderInputReadiness(missingAudio).ready, false);
assert.match(renderInputReadiness(missingAudio).error, /缺少配音的场景：2/);
assert.match(renderInputReadiness({ currentVersion: { scenes: [] } }).error, /还没有可渲染的场景/);
const qualityBlocked = renderInputReadiness({
  ...project,
  qualityErrors: [{ code: "audio-overrun", sceneNumber: 1, media: "audio", severity: "error", message: "场景 1 的配音超时。" }]
});
assert.equal(qualityBlocked.ready, false);
assert.equal(qualityBlocked.qualityIssues[0].code, "audio-overrun");
assert.match(qualityBlocked.error, /配音超时/);
assert.match(route, /renderInputReadiness/);
assert.match(route, /const readiness = renderInputReadiness\(project\)/);
assert.match(route, /if \(!readiness\.ready\)/);
assert.match(route, /readiness\.error/);
assert.match(route, /qualityIssues: readiness\.qualityIssues/);
assert.match(route, /readiness\.inputs\.map/);
assert.match(route, /invalidProductionMedia/);
assert.match(route, /pushInvalidInput/);
assert.match(route, /input\.scope === "production"/);
assert.match(source, /品牌 Logo/);
assert.match(source, /背景音乐/);
assert.match(route, /请重新生成或重新上传后再导出/);

console.log("Render input preflight smoke checks passed.");
