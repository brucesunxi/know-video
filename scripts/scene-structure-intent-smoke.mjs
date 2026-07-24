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
const {
  normalizeSceneReferences,
  requestWithoutSceneStructureClauses,
  requestsSceneStructureChange,
  sceneStructureFromRequest,
  sceneStructuresFromRequest
} = structureModule.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));
const scenes = [1, 2, 3, 4, 5];

assert.deepEqual(plain(sceneStructureFromRequest("删除第 2 场景", scenes)), { operation: "delete", sceneNumber: 2 });
assert.deepEqual(plain(sceneStructureFromRequest("复制第 3 个镜头", scenes)), { operation: "duplicate", sceneNumber: 3 });
assert.deepEqual(plain(sceneStructureFromRequest("把第 4 场景向前移动", scenes)), { operation: "move", sceneNumber: 4, direction: "earlier" });
assert.deepEqual(plain(sceneStructureFromRequest("把第 2 场景移动到第 5 位", scenes)), { operation: "move-to", sceneNumber: 2, targetSceneNumber: 5 });
assert.deepEqual(plain(sceneStructureFromRequest("第 4 个镜头移到第 1 个场景", scenes)), { operation: "move-to", sceneNumber: 4, targetSceneNumber: 1 });
assert.deepEqual(plain(sceneStructureFromRequest("把第 2 场景拆分成两个镜头", scenes)), { operation: "split", sceneNumber: 2 });
assert.deepEqual(plain(sceneStructureFromRequest("合并第 2 和第 3 场景", scenes)), { operation: "merge-next", sceneNumber: 2 });
assert.deepEqual(plain(sceneStructureFromRequest("把第 4 场景和后一场景合并", scenes)), { operation: "merge-next", sceneNumber: 4 });
assert.equal(sceneStructureFromRequest("合并第 2 和第 4 场景", scenes), undefined);
assert.deepEqual(plain(sceneStructureFromRequest("第 1 场景时长改成 6 秒", scenes)), { operation: "set-duration", sceneNumber: 1, durationSeconds: 6 });
assert.deepEqual(plain(sceneStructureFromRequest("把第 3 场景改成 0.75 秒叠化转场", scenes)), { operation: "set-transition", sceneNumber: 3, kind: "dissolve", durationSeconds: 0.75 });
assert.deepEqual(plain(sceneStructureFromRequest("第 2 个镜头直接硬切", scenes)), { operation: "set-transition", sceneNumber: 2, kind: "cut", durationSeconds: 0 });
assert.deepEqual(plain(sceneStructureFromRequest("第 4 场景使用向左推进转场", scenes)), { operation: "set-transition", sceneNumber: 4, kind: "push-left", durationSeconds: 0.25 });
assert.deepEqual(plain(sceneStructureFromRequest("删除第二个分镜", scenes)), { operation: "delete", sceneNumber: 2 });
assert.deepEqual(plain(sceneStructureFromRequest("复制最后一个分镜", scenes)), { operation: "duplicate", sceneNumber: 5 });
assert.deepEqual(plain(sceneStructureFromRequest("删除倒数第二个镜头", scenes)), { operation: "delete", sceneNumber: 4 });
assert.deepEqual(plain(sceneStructuresFromRequest("删除第二个分镜，然后把第五个分镜移动到第一位", scenes)), [
  { operation: "delete", sceneNumber: 2 },
  { operation: "move-to", sceneNumber: 5, targetSceneNumber: 1 }
]);
assert.equal(requestWithoutSceneStructureClauses("删除第二个分镜，并把全片配音换成女声", scenes), "把全片配音换成女声");
assert.equal(normalizeSceneReferences("把第二个分镜移到最后一个分镜", scenes), "把第2个场景移到第5个场景");
assert.equal(sceneStructureFromRequest("第 1 场景使用叠化转场", scenes), undefined);
assert.equal(sceneStructureFromRequest("删除一个场景", scenes), undefined);
assert.equal(requestsSceneStructureChange("删除第 2 场景"), true);
assert.equal(requestsSceneStructureChange("把第 2 场景移动到第 5 位"), true);
assert.equal(requestsSceneStructureChange("把第 2 场景拆成两个镜头"), true);
assert.equal(requestsSceneStructureChange("合并第 2 和第 3 场景"), true);
assert.equal(requestsSceneStructureChange("把第 3 场景改成叠化转场"), true);
assert.equal(requestsSceneStructureChange("把第 2 场景改成浅色"), false);

console.log("Scene structure intent smoke checks passed.");
