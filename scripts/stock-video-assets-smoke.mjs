import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/stock-video-assets.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
let env = {};
const module = { exports: {} };
vm.runInNewContext(output, {
  module,
  exports: module.exports,
  require: (name) => {
    if (name === "@/lib/env") return { getOptionalEnv: (key) => env[key] };
    if (name === "@/lib/r2") return {};
    throw new Error(`Unexpected import: ${name}`);
  }
});

const { hasFreeStockVideoProvider, stockSearchTerms } = module.exports;
const scene = (overrides = {}) => ({
  title: "幼儿园的一天",
  voiceover: "孩子们在明亮的教室里探索和学习。",
  visualPrompt: "老师陪伴孩子完成一次动手活动。",
  style: {},
  ...overrides
});

assert.deepEqual(Array.from(stockSearchTerms(scene())), ["kindergarten classroom children learning", "classroom students learning"]);
assert.deepEqual(Array.from(stockSearchTerms(scene({ style: { stockSearchTerms: ["children painting classroom", "teacher reading story"] } }))), [
  "children painting classroom",
  "teacher reading story"
]);
assert.equal(hasFreeStockVideoProvider(), false);
env = { PEXELS_API_KEY: "free-key" };
assert.equal(hasFreeStockVideoProvider(), true);
assert.match(source, /api\.pexels\.com\/v1\/videos\/search/);
assert.match(source, /costUsd: 0/);
assert.match(source, /moneyprinterturbo-inspired-stock-cut/);

console.log("Free stock video asset smoke checks passed.");
