import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/generation-requests.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, {
  module,
  exports: module.exports,
  require: (id) => {
    if (id === "node:crypto") return { createHash };
    if (id === "@/lib/db") return { getSql: () => undefined, hasDatabaseUrl: () => false };
    return {};
  }
});

const { generationRequestFingerprint } = module.exports;
const options = {
  duration: "30",
  sceneCount: "5",
  language: "中文",
  style: "电影质感",
  motion: "key-scenes"
};
const first = generationRequestFingerprint("  生成产品介绍视频  ", options);
const second = generationRequestFingerprint("生成产品介绍视频", options);
const changedPrompt = generationRequestFingerprint("生成教育产品介绍视频", options);
const changedStyle = generationRequestFingerprint("生成产品介绍视频", { ...options, style: "极简高级" });

assert.match(first, /^[a-f0-9]{64}$/);
assert.equal(first, second);
assert.notEqual(first, changedPrompt);
assert.notEqual(first, changedStyle);

console.log("Generation request smoke checks passed.");
