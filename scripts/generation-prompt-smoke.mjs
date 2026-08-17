import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/generation-prompt.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports });
const { contentPromptForGeneration } = module.exports;

assert.equal(
  contentPromptForGeneration("帮我生成一个深度烘焙咖啡店广告。\n\n应用“拼贴纸艺”的 style：纸张纹理、层叠卡片。"),
  "帮我生成一个深度烘焙咖啡店广告。"
);
assert.equal(
  contentPromptForGeneration("Create a deep-roast coffee shop commercial.\n\nApply the “Paper collage” style: tactile textures and layered cutouts."),
  "Create a deep-roast coffee shop commercial."
);
assert.equal(
  contentPromptForGeneration("Apply the “Paper collage” style: Paper-collage style with tactile textures, layered cutouts, bright color blocks, and handmade transitions.帮我生成一个咖啡店宣传广告。"),
  "帮我生成一个咖啡店宣传广告。"
);
assert.equal(contentPromptForGeneration("  展示咖啡豆烘焙、手冲和顾客品尝。  "), "展示咖啡豆烘焙、手冲和顾客品尝。");

console.log("Generation content prompt smoke checks passed.");
