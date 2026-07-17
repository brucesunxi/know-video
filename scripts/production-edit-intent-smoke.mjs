import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/production-edit-intent.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports });
const { isProductionOnlyRequest, productionSettingsFromRequest } = module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

assert.deepEqual(
  plain(productionSettingsFromRequest("关闭字幕，全片改成 1.25 倍速")),
  { captionsEnabled: false, playbackRate: 1.25 }
);
assert.deepEqual(
  plain(productionSettingsFromRequest("字幕使用强调色，背景音乐调到 10%")),
  { captionStyle: "highlight", musicVolume: 0.1 }
);
assert.deepEqual(
  plain(productionSettingsFromRequest("把 Logo 放在左上角并放大")),
  { logoPosition: "top-left", logoSize: 16 }
);
assert.equal(isProductionOnlyRequest("关闭字幕，全片改成 1.25 倍速"), true);
assert.equal(isProductionOnlyRequest("关闭字幕，再把第 2 场景改成浅色"), false);
assert.deepEqual(plain(productionSettingsFromRequest("把所有旁白改成中文")), {});

console.log("Production edit intent smoke checks passed.");
