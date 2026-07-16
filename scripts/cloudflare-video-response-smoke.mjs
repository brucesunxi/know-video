import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/cloudflare-video-response.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, Buffer });
const { isMp4Buffer, parseCloudflareVideoUrl } = module.exports;

const videoUrl = "https://example.com/generated.mp4";
assert.equal(parseCloudflareVideoUrl({ state: "Completed", result: { video: videoUrl } }), videoUrl);
assert.equal(parseCloudflareVideoUrl({ success: true, result: { state: "Completed", result: { video: videoUrl } } }), videoUrl);
assert.equal(parseCloudflareVideoUrl({ state: "Running", result: { video: videoUrl } }), undefined);
assert.equal(parseCloudflareVideoUrl({ state: "Completed", result: { video: "javascript:alert(1)" } }), undefined);
assert.equal(isMp4Buffer(Buffer.from("000000186674797069736f6d", "hex")), true);
assert.equal(isMp4Buffer(Buffer.from("not-an-mp4")), false);

console.log("Cloudflare video response smoke checks passed.");
