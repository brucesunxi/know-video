import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/media-generation-result.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports });
const { mediaGenerationFailureMessage, mediaGenerationProgress } = module.exports;

const partial = mediaGenerationProgress([5, 2, 2, 1, 4], [4, 9, 2]);
assert.deepEqual(Array.from(partial.requestedSceneNumbers), [1, 2, 4, 5]);
assert.deepEqual(Array.from(partial.completedSceneNumbers), [1, 5]);
assert.deepEqual(Array.from(partial.failedSceneNumbers), [2, 4]);
assert.equal(
  mediaGenerationFailureMessage("画面", partial, "请稍后重试。"),
  "场景 1、5 已完成；场景 2、4 的画面未完成。请稍后重试。"
);

const failed = mediaGenerationProgress([3], [3]);
assert.equal(
  mediaGenerationFailureMessage("配音", failed, "请检查配置。"),
  "场景 3 的配音未完成。请检查配置。"
);

const success = mediaGenerationProgress([3, 1], []);
assert.deepEqual(Array.from(success.completedSceneNumbers), [1, 3]);
assert.deepEqual(Array.from(success.failedSceneNumbers), []);

console.log("Media generation result smoke checks passed.");
