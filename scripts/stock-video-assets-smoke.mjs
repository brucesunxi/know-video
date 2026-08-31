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
    if (name === "@/lib/style-motion-policy") return { styleAllowsFreeStockVideo: () => true };
    if (name === "@/lib/stock-candidate-policy") return {
      rankStockCandidates: (_scene, candidates) => candidates.map((candidate) => ({
        candidate,
        evaluation: { locallyTrusted: true, relevanceScore: 10, descriptor: "relevant stock candidate" }
      }))
    };
    if (name === "@/lib/operation-deadline") return {
      boundedOperationTimeout: ({ maxTimeoutMs }) => maxTimeoutMs
    };
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
assert.deepEqual(Array.from(stockSearchTerms(scene({
  title: "包子铺宣传片",
  voiceover: "现包现蒸，热气腾腾。",
  visualPrompt: "师傅打开竹蒸笼。"
}))), [
  "steamed buns bamboo steamer cooking",
  "dumpling chef kitchen food preparation",
  "asian bakery kitchen cooking"
]);
assert.deepEqual(Array.from(stockSearchTerms(scene({
  title: "图书馆宣传片",
  voiceover: "读者在书架间找到想读的书。",
  visualPrompt: "安静阅览室和纵深书架。"
}))), [
  "library bookshelves people reading",
  "reader choosing book library shelves",
  "quiet library study reading room"
]);
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
assert.match(source, /recoveryFallback/);
assert.match(source, /asset\.metadata\?\.source !== "free-stock-video"/);
assert.match(source, /`\$\{provider\}:\$\{providerId\}`/);
assert.match(source, /styleProtectedSceneNumbers/);
assert.match(source, /styleAllowsFreeStockVideo\(scene\.style\)/);
assert.match(source, /function projectNarrativeContext/);
assert.match(source, /project\.currentVersion\.scenes\.flatMap\(\(scene\) => \[scene\.title, scene\.voiceover\]\)/);
assert.match(source, /rankStockCandidates\([\s\S]*narrativeContext/);
assert.match(source, /evaluation\.locallyTrusted/);
assert.match(source, /localRelevanceScore/);
assert.match(source, /deadlineMs\?: number/);
assert.match(source, /operation: "Free stock video upload"/);
assert.match(source, /maxTimeoutMs: 60_000/);

console.log("Free stock video asset smoke checks passed.");
