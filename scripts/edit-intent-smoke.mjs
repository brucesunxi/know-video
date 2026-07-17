import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/edit-intent.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports });

const { analyzeEditIntent, extractRequestedSceneNumbers, requestsGeneratedClip } = module.exports;
const scenes = [1, 2, 3, 4, 5, 6];

assert.deepEqual(Array.from(extractRequestedSceneNumbers("只修改第五个镜头", scenes)), [5]);
assert.deepEqual(Array.from(extractRequestedSceneNumbers("Update scene 3 and shot 6", scenes)), [3, 6]);
assert.deepEqual(Array.from(extractRequestedSceneNumbers("调整第2章节", scenes)), [2]);
assert.deepEqual(Array.from(extractRequestedSceneNumbers("把第2到第4场景变亮", scenes)), [2, 3, 4]);
assert.deepEqual(Array.from(extractRequestedSceneNumbers("把第2和第3场景都变亮", scenes)), [2, 3]);
assert.deepEqual(Array.from(extractRequestedSceneNumbers("调整第1、3、5个镜头", scenes)), [1, 3, 5]);
assert.deepEqual(Array.from(extractRequestedSceneNumbers("Update scene 2-4", scenes)), [2, 3, 4]);
assert.deepEqual(Array.from(extractRequestedSceneNumbers("让前三个镜头节奏更快", scenes)), [1, 2, 3]);
assert.deepEqual(Array.from(extractRequestedSceneNumbers("修改最后一个场景", scenes)), [6]);
assert.equal(requestsGeneratedClip("让第 2 场景动起来"), true);
assert.equal(requestsGeneratedClip("把全片生成动态镜头"), true);
assert.equal(requestsGeneratedClip("把第 2 场景标题改短"), false);

assert.deepEqual(
  JSON.parse(JSON.stringify(analyzeEditIntent("把语言都改为中文", scenes))),
  {
    explicitSceneNumbers: [],
    global: true,
    globalChineseRewrite: true,
    preserveVisualAssetsOnLocalization: true
  }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(analyzeEditIntent("把语言改成中文", scenes))),
  {
    explicitSceneNumbers: [],
    global: true,
    globalChineseRewrite: true,
    preserveVisualAssetsOnLocalization: true
  }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(analyzeEditIntent("只把第五个镜头改成中文", scenes))),
  {
    explicitSceneNumbers: [5],
    global: false,
    globalChineseRewrite: false,
    preserveVisualAssetsOnLocalization: false
  }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(analyzeEditIntent("第五个镜头都改成中文", scenes))),
  {
    explicitSceneNumbers: [5],
    global: false,
    globalChineseRewrite: false,
    preserveVisualAssetsOnLocalization: false
  }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(analyzeEditIntent("整体风格调整为明亮高级", scenes))),
  {
    explicitSceneNumbers: [],
    global: true,
    globalChineseRewrite: false,
    preserveVisualAssetsOnLocalization: false
  }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(analyzeEditIntent("把配音速度放慢", scenes))),
  {
    explicitSceneNumbers: [],
    global: true,
    globalChineseRewrite: false,
    preserveVisualAssetsOnLocalization: false
  }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(analyzeEditIntent("把全片改成中文，并换成明亮的视觉风格", scenes))),
  {
    explicitSceneNumbers: [],
    global: true,
    globalChineseRewrite: true,
    preserveVisualAssetsOnLocalization: false
  }
);

console.log("Edit intent smoke checks passed.");
