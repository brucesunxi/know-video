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
assert.equal(
  sanitizeNarrationForSpeech("这是一段关于餐馆介绍的视频。暖光与香气，从推门的一刻迎接每位客人。"),
  "暖光与香气，从推门的一刻迎接每位客人。"
);
assert.equal(
  sanitizeNarrationForSpeech("在这个视频中，我们将介绍一家餐馆。Fresh ingredients are prepared with care."),
  "Fresh ingredients are prepared with care."
);
assert.equal(
  sanitizeNarrationForSpeech("This video is about a restaurant introduction. A warm welcome begins at the door."),
  "A warm welcome begins at the door."
);
assert.equal(sanitizeNarrationForSpeech("本视频将为您介绍这家餐馆。"), "");

console.log("Narration cleanup smoke checks passed.");
