import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/cloudflare-vision-response.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require: () => ({}) });
const { parseCloudflareVisionDescription } = module.exports;

assert.equal(
  parseCloudflareVisionDescription({ answer: "  A player explores a neon game level.  " }),
  "A player explores a neon game level."
);
assert.equal(
  parseCloudflareVisionDescription({ success: true, result: { caption: "A colorful crafting interface." } }),
  "A colorful crafting interface."
);
assert.equal(
  parseCloudflareVisionDescription({ result: { result: { description: "A gameplay objective marker." } } }),
  "A gameplay objective marker."
);
assert.equal(parseCloudflareVisionDescription({ answer: "   ", result: {} }), undefined);
assert.equal(parseCloudflareVisionDescription(undefined), undefined);
assert.equal(parseCloudflareVisionDescription({ answer: "a".repeat(1_700) }).length, 1_600);

console.log("Cloudflare vision response smoke checks passed.");
