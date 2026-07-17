import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function transpile(path) {
  return ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
}

const editModule = { exports: {} };
vm.runInNewContext(transpile("../lib/edit-intent.ts"), { module: editModule, exports: editModule.exports });
const candidateModule = { exports: {} };
vm.runInNewContext(transpile("../lib/candidate-edit-intent.ts"), {
  module: candidateModule,
  exports: candidateModule.exports,
  require: (name) => {
    if (name === "@/lib/edit-intent") return editModule.exports;
    throw new Error(`Unexpected import: ${name}`);
  }
});

const { candidateEditFromRequest } = candidateModule.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));
const scenes = [1, 2, 3, 4, 5];

assert.deepEqual(
  plain(candidateEditFromRequest("给第 2 场景做一个更明亮、不要文字的候选图", scenes)),
  { sceneNumber: 2, instruction: "更明亮、不要文字" }
);
assert.deepEqual(
  plain(candidateEditFromRequest("第 3 个镜头先别替换，背景更简洁，生成一个备选画面", scenes)),
  { sceneNumber: 3, instruction: "背景更简洁" }
);
assert.equal(candidateEditFromRequest("把第 2 场景改得更明亮", scenes), undefined);
assert.equal(candidateEditFromRequest("给第 2 和第 3 场景都做候选图", scenes), undefined);
assert.equal(candidateEditFromRequest("做一张更电影感的候选图", scenes), undefined);
assert.deepEqual(
  plain(candidateEditFromRequest("给这个场景做一张更电影感的候选图", scenes, 4)),
  { sceneNumber: 4, instruction: "更电影感" }
);
assert.equal(candidateEditFromRequest("给第 9 场景做候选图", scenes), undefined);
assert.deepEqual(
  plain(candidateEditFromRequest("为最后一个场景生成候选画面", scenes)),
  { sceneNumber: 5, instruction: "保持主体与叙事不变，优化构图、光影和空间层次，使画面更精致。" }
);

console.log("Candidate edit intent smoke checks passed.");
