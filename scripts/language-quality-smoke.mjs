import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/language-quality.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports });
const { looksSimplifiedChineseLocalized } = module.exports;

assert.equal(looksSimplifiedChineseLocalized("把所有场景的标题和旁白改为中文。"), true);
assert.equal(looksSimplifiedChineseLocalized("Know Video 的 AI 视频生成流程进入中文旁白。"), true);
assert.equal(looksSimplifiedChineseLocalized("中文仪表盘展示 SaaS 团队的 MP4 导出状态。"), true);
assert.equal(looksSimplifiedChineseLocalized("Still English"), false);
assert.equal(looksSimplifiedChineseLocalized("Customization 中文"), false);
assert.equal(looksSimplifiedChineseLocalized("中文画面 with spacious studio and reflective surfaces"), false);
assert.equal(looksSimplifiedChineseLocalized(""), false);

console.log("Language quality smoke checks passed.");
