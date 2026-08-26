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
const { parseCloudflareVisionDescription, parseGeneratedImageInspection, parseImageSemanticMatch, parseImageTextPresence } = module.exports;

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
assert.equal(parseImageTextPresence({ answer: "TEXT_PRESENT" }), true);
assert.equal(parseImageTextPresence({ result: { answer: "TEXT_FREE" } }), false);
assert.equal(parseImageTextPresence({ answer: "Text-free." }), false);
assert.equal(parseImageTextPresence({ answer: "No visible text" }), false);
assert.equal(parseImageTextPresence({ answer: "No text present" }), false);
assert.equal(parseImageTextPresence({ answer: "Text detected" }), true);
assert.equal(parseImageTextPresence({ answer: "TEXT_PRESENT; this is not TEXT_FREE" }), true);
assert.equal(parseImageTextPresence({ answer: "The image is unclear." }), undefined);
assert.equal(parseImageSemanticMatch({ answer: "SEMANTIC_MATCH" }), true);
assert.equal(parseImageSemanticMatch({ result: { answer: "SEMANTIC_MISMATCH" } }), false);
assert.equal(parseImageSemanticMatch({ answer: "The image is unclear." }), undefined);
assert.equal(parseGeneratedImageInspection({ answer: "IMAGE_PASS" }), "pass");
assert.equal(parseGeneratedImageInspection({ answer: "Image pass." }), "pass");
assert.equal(parseGeneratedImageInspection({ answer: "style-mismatch" }), "style_mismatch");
assert.equal(parseGeneratedImageInspection({ answer: "TEXT_PRESENT" }), "text_present");
assert.equal(parseGeneratedImageInspection({ answer: "STYLE_MISMATCH" }), "style_mismatch");
assert.equal(parseGeneratedImageInspection({ answer: "SEMANTIC_MISMATCH" }), "semantic_mismatch");

console.log("Cloudflare vision response smoke checks passed.");
