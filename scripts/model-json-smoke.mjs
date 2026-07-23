import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/model-json.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports });
const { parseModelJson } = module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

assert.deepEqual(plain(parseModelJson("```json\n{\"title\":\"ok\",\"scenes\":[]}\n```")), {
  title: "ok",
  scenes: []
});
assert.deepEqual(plain(parseModelJson(`{
  "title": "跨境库存"
  "scenes": [
    { "title": "库存预警", "durationSeconds": 6 }
    { "title": "仓间调拨", "durationSeconds": 6 },
  ],
}`)), {
  title: "跨境库存",
  scenes: [
    { title: "库存预警", durationSeconds: 6 },
    { title: "仓间调拨", durationSeconds: 6 }
  ]
});

console.log("Model JSON repair smoke checks passed.");
