import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const aiVideo = fs.readFileSync(new URL("../lib/ai-video.ts", import.meta.url), "utf8");
const languageQuality = fs.readFileSync(new URL("../lib/language-quality.ts", import.meta.url), "utf8");

assert.match(aiVideo, /function buildGlobalChineseFallbackPayload/);
assert.match(aiVideo, /function buildGlobalChineseFallbackEditPlan/);
assert.match(aiVideo, /if \(!textModel\)[\s\S]*buildGlobalChineseFallbackEditPlan/);
assert.match(aiVideo, /Global Chinese edit plan failed validation[\s\S]*buildGlobalChineseFallbackEditPlan/);
assert.match(aiVideo, /恢复后暂不可导出 MP4|全片中文|统一改为中文|中文本地化|中文叙事重点/);
assert.match(aiVideo, /preserveVisualAssetsOnLocalization[\s\S]*\["audio", "caption", "render"\]/);
assert.match(aiVideo, /\["image", "audio", "thumbnail", "caption", "render"\]/);

const output = ts.transpileModule(languageQuality, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports });
const { looksSimplifiedChineseLocalized } = module.exports;

const fallbackTexts = [
  "场景 1：中文叙事重点",
  "第 1 个场景使用自然中文旁白，延续原有叙事目的，清楚表达本段重点，并与整支视频的节奏保持一致。",
  "第 1 个场景的中文视觉方案：保留原有镜头目的和构图层级，画面主体清晰，背景干净，光线统一，色彩与整支视频一致，避免英文大段文字出现在画面中。",
  "第 1 个场景的中文镜头运动：保持原有节奏，使用平稳推进、轻微视差或自然转场，让画面重点逐步呈现，并与中文旁白同步。"
];

for (const text of fallbackTexts) {
  assert.equal(looksSimplifiedChineseLocalized(text), true, text);
}

console.log("Global Chinese fallback smoke checks passed.");
