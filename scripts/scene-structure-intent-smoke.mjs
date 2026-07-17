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
const structureModule = { exports: {} };
const localRequire = (name) => {
  if (name === "@/lib/edit-intent") return editModule.exports;
  throw new Error(`Unexpected import: ${name}`);
};
vm.runInNewContext(transpile("../lib/scene-structure-intent.ts"), {
  module: structureModule,
  exports: structureModule.exports,
  require: localRequire
});
const { requestsSceneStructureChange, sceneStructureFromRequest } = structureModule.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));
const scenes = [1, 2, 3, 4, 5];

assert.deepEqual(plain(sceneStructureFromRequest("删除第 2 场景", scenes)), { operation: "delete", sceneNumber: 2 });
assert.deepEqual(plain(sceneStructureFromRequest("复制第 3 个镜头", scenes)), { operation: "duplicate", sceneNumber: 3 });
assert.deepEqual(plain(sceneStructureFromRequest("把第 4 场景向前移动", scenes)), { operation: "move", sceneNumber: 4, direction: "earlier" });
assert.deepEqual(plain(sceneStructureFromRequest("第 1 场景时长改成 6 秒", scenes)), { operation: "set-duration", sceneNumber: 1, durationSeconds: 6 });
assert.equal(sceneStructureFromRequest("删除一个场景", scenes), undefined);
assert.equal(requestsSceneStructureChange("删除第 2 场景"), true);
assert.equal(requestsSceneStructureChange("把第 2 场景改成浅色"), false);

console.log("Scene structure intent smoke checks passed.");
