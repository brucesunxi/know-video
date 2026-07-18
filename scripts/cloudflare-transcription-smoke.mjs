import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/cloudflare-transcription.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require: () => ({}) });
const { parseCloudflareTranscript } = module.exports;

assert.equal(parseCloudflareTranscript({ text: "  Hello   world.  " }), "Hello world.");
assert.equal(
  parseCloudflareTranscript({ text: "fallback", transcription_info: { text: "  这是上传音频的转写。 " } }),
  "这是上传音频的转写。"
);
assert.equal(parseCloudflareTranscript({ text: "   " }), undefined);
assert.equal(parseCloudflareTranscript({}), undefined);
assert.equal(parseCloudflareTranscript({ text: "a".repeat(8_100) }).length, 8_000);

console.log("Cloudflare transcription response smoke checks passed.");
