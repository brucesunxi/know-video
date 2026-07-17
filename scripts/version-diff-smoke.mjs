import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/version-diff.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports });
const { summarizeVersionChange } = module.exports;
const scene = (sceneNumber, title, durationSeconds = 5) => ({
  sceneNumber,
  title,
  voiceover: `旁白 ${title}`,
  visualPrompt: `画面 ${title}`,
  motionPrompt: "轻推",
  durationSeconds,
  style: { theme: "dark", palette: ["#000", "#fff"], mood: "calm" }
});

assert.deepEqual(
  JSON.parse(JSON.stringify(summarizeVersionChange([scene(1, "A")], null))),
  { changedScenes: 0, addedScenes: 1, removedScenes: 0, durationDelta: 5, description: "初始版本" }
);
assert.equal(
  summarizeVersionChange([scene(1, "A"), scene(2, "B2", 7), scene(3, "C")], [scene(1, "A"), scene(2, "B")]).description,
  "修改 1 个场景 · 新增 1 个场景 · 时长+7 秒"
);
assert.equal(
  summarizeVersionChange(JSON.stringify([scene(1, "A")]), JSON.stringify([scene(1, "A"), scene(2, "B")])).description,
  "删除 1 个场景 · 时长-5 秒"
);
assert.equal(
  summarizeVersionChange([scene(1, "A")], [scene(1, "A")]).description,
  "仅更新素材或成片设置"
);

console.log("Version diff smoke checks passed.");
