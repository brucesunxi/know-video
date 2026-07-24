import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/production-settings.ts", import.meta.url), "utf8");
const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports });
const {
  DEFAULT_PRODUCTION_SETTINGS,
  effectiveSceneDurationSeconds,
  effectiveVersionDurationSeconds,
  productionDurationInFrames,
  productionSettingsFromScenes
} = module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

assert.deepEqual(plain(productionSettingsFromScenes([])), plain(DEFAULT_PRODUCTION_SETTINGS));
assert.deepEqual(plain(productionSettingsFromScenes([{ style: { production: {
  captionsEnabled: false,
  captionStyle: "highlight",
  playbackRate: 1.25,
  musicVolume: 0.9,
  logoPosition: "bottom-left",
  logoSize: 99
} } }])), {
  captionsEnabled: false,
  captionStyle: "highlight",
  playbackRate: 1.25,
  musicVolume: 0.5,
  musicDucking: "balanced",
  logoPosition: "bottom-left",
  logoSize: 24
});
assert.deepEqual(plain(productionSettingsFromScenes([{ style: { production: {
  captionStyle: "broken",
  playbackRate: 7,
  musicVolume: "broken",
  logoPosition: "center",
  logoSize: "broken"
} } }])), plain(DEFAULT_PRODUCTION_SETTINGS));
assert.equal(productionDurationInFrames({ durationSeconds: 30, scenes: [{ style: { production: { playbackRate: 1.5 } } }] }, 30), 600);

const pacedScenes = [
  {
    durationSeconds: 6,
    style: {},
    assets: [{
      type: "audio",
      url: "/scene-1.wav",
      metadata: { actualDurationSeconds: 3.5, audibleEndSeconds: 3.42 }
    }]
  },
  {
    durationSeconds: 6,
    style: {},
    assets: [{
      type: "audio",
      url: "/scene-2.wav",
      metadata: { actualDurationSeconds: 4.9, audibleEndSeconds: 4.84 }
    }]
  }
];
assert.equal(effectiveSceneDurationSeconds(pacedScenes[0], false), 3.56);
assert.equal(effectiveSceneDurationSeconds(pacedScenes[1], true), 5.29);
assert.equal(effectiveVersionDurationSeconds({ durationSeconds: 12, scenes: pacedScenes }), 8.85);
assert.equal(productionDurationInFrames({ durationSeconds: 12, scenes: pacedScenes }, 30), 266);
assert.equal(effectiveSceneDurationSeconds({ durationSeconds: 6, style: {}, assets: [] }, false), 6);
assert.equal(effectiveSceneDurationSeconds({
  durationSeconds: 4,
  style: {},
  assets: [{ type: "audio", url: "/long.wav", metadata: { actualDurationSeconds: 4.2 } }]
}, false), 4.28);

assert.match(workspace, /function productionSummaryItems/);
assert.match(workspace, /function productionImpactChecks/);
assert.match(workspace, /covered\.length === 0 && productionSettingLabels\(plan\.productionSettings\)\.length > 0[\s\S]*if \(intent\.global\)/);
assert.match(workspace, /aria-label="成片输出摘要"/);
assert.match(workspace, /aria-label="成片设置导出影响"/);
assert.match(workspace, /导出影响预览/);
assert.match(workspace, /这些设置会直接进入播放器预览和 MP4 合成/);
assert.match(workspace, /字幕层/);
assert.match(workspace, /背景音乐/);
assert.match(workspace, /品牌 Logo/);
assert.match(workspace, /durationSeconds=\{project\.currentVersion\.durationSeconds\}/);
assert.match(workspace, /导出时自动混音/);
assert.match(workspace, /仅保留旁白音轨/);
assert.match(styles, /\.kv-production-summary/);
assert.match(styles, /\.kv-production-impact/);
assert.match(styles, /\.kv-production-impact ul/);
assert.match(styles, /\.kv-production-impact li\.ready/);
assert.match(styles, /\.kv-production-impact li\.muted/);
assert.match(styles, /@media \(max-width: 360px\)[\s\S]*\.kv-production-summary|@media \(max-width: 760px\)[\s\S]*\.kv-production-summary|@media \(max-width: 1040px\)[\s\S]*\.kv-production-summary/);
assert.match(styles, /@media \(max-width: 1040px\)[\s\S]*\.kv-production-impact ul[\s\S]*grid-template-columns: 1fr/);

console.log("Production settings smoke checks passed.");
