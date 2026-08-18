import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/style-motion-policy.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require: () => ({}) });
const { freeStockVideoColorGrade, styleAllowsFreeStockVideo } = module.exports;

assert.equal(styleAllowsFreeStockVideo({ visualStyleId: "cinematic-realism" }), true);
for (const visualStyleId of [
  "chalkboard",
  "simple-line",
  "collage",
  "comic-book",
  "memphis",
  "isometric",
  "pixel-art",
  "safety-poster",
  "product-ui"
]) {
  assert.equal(styleAllowsFreeStockVideo({ visualStyleId }), false, `${visualStyleId} should preserve generated images`);
}
assert.equal(styleAllowsFreeStockVideo({ visualStylePrompt: "Documentary live-action photography" }), true);
assert.equal(styleAllowsFreeStockVideo({ visualStylePrompt: "Hand-drawn chalk illustration" }), false);
assert.match(freeStockVideoColorGrade({ mood: "warm natural light" }), /sepia/);

console.log("Style and motion compatibility smoke checks passed.");
