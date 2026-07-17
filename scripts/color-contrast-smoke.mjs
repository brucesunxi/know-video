import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/color-contrast.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require: () => ({}) });
const { readableTextColor, sceneAccentColor } = module.exports;

assert.equal(sceneAccentColor(["#08111f", "#22c7b8"]), "#22c7b8");
assert.equal(sceneAccentColor(["#10223d", "#f5c46b"]), "#f5c46b");
assert.equal(sceneAccentColor(["#15152a", "#8fd8ff"]), "#8fd8ff");
assert.equal(sceneAccentColor(["invalid", "#08111f"]), "#22c7b8");
assert.equal(readableTextColor("#f5c46b"), "#06111f");
assert.equal(readableTextColor("#274060"), "#ffffff");

console.log("Color contrast smoke checks passed.");
