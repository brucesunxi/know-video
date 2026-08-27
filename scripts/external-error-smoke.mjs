import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/external-error.ts", import.meta.url), "utf8");
const imageAssets = fs.readFileSync(new URL("../lib/image-assets.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, Number });

const {
  externalErrorCode,
  externalErrorMessage,
  externalErrorName,
  externalErrorStatus
} = module.exports;

const timeout = new DOMException("The operation timed out", "TimeoutError");
assert.equal(externalErrorCode(timeout), String(timeout.code));
assert.equal(externalErrorName(timeout), "TimeoutError");
assert.equal(externalErrorMessage(timeout), "The operation timed out");
assert.equal(externalErrorStatus({ status: "429" }), 429);
assert.equal(externalErrorStatus({ status: "not-a-number" }), undefined);
assert.equal(externalErrorCode({ code: { nested: true } }), "");
assert.equal(externalErrorCode(null), "");
assert.match(imageAssets, /const code = externalErrorCode\(error\)/);
assert.match(imageAssets, /const name = externalErrorName\(error\)/);
assert.doesNotMatch(imageAssets, /\.code\?\.includes|\.name\?\.includes/);

console.log("External provider error normalization smoke checks passed.");
