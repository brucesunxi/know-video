import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/narration-cleanup.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports });
const { sanitizeNarrationForSpeech } = module.exports;

assert.equal(
  sanitizeNarrationForSpeech("DIY 游戏从这里开始。DIY 游戏从这里开始。进入自由创作。"),
  "DIY 游戏从这里开始。进入自由创作。"
);
assert.equal(
  sanitizeNarrationForSpeech("先选择地图，选择地图，再邀请好友。"),
  "先选择地图，再邀请好友。"
);
assert.equal(
  sanitizeNarrationForSpeech("Create freely. Create freely. Share the result."),
  "Create freely. Share the result."
);

console.log("Narration cleanup smoke checks passed.");
