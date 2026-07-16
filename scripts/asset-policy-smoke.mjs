import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../lib/asset-policy.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, {
  Buffer,
  exports: module.exports,
  module,
  require: () => ({})
});

const {
  matchesDeclaredAssetType,
  maxUploadBytes,
  supportedUploadContentTypes,
  uploadedAssetType
} = module.exports;

const bytes = (...values) => Uint8Array.from(values);
const ascii = (value) => new TextEncoder().encode(value);

assert.equal(uploadedAssetType("IMAGE/PNG"), "image");
assert.equal(uploadedAssetType("image/svg+xml"), undefined);
assert.equal(uploadedAssetType("video/quicktime"), undefined);
assert.deepEqual(
  Array.from(supportedUploadContentTypes()),
  [
    "image/jpeg",
    "image/png",
    "image/webp",
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
    "video/mp4",
    "video/webm"
  ]
);

assert.equal(matchesDeclaredAssetType(bytes(0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0), "image/jpeg"), true);
assert.equal(matchesDeclaredAssetType(bytes(0x89, ...ascii("PNG"), 0, 0, 0, 0, 0, 0, 0, 0), "image/png"), true);
assert.equal(matchesDeclaredAssetType(ascii("RIFF0000WEBP"), "image/webp"), true);
assert.equal(matchesDeclaredAssetType(ascii("ID3000000000"), "audio/mpeg"), true);
assert.equal(matchesDeclaredAssetType(ascii("RIFF0000WAVE"), "audio/wav"), true);
assert.equal(matchesDeclaredAssetType(ascii("0000ftyp0000"), "video/mp4"), true);
assert.equal(matchesDeclaredAssetType(bytes(0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0), "video/webm"), true);
assert.equal(matchesDeclaredAssetType(ascii("<svg></svg>!"), "image/png"), false);
assert.equal(matchesDeclaredAssetType(ascii("RIFF0000WEBP"), "audio/wav"), false);

assert.equal(maxUploadBytes("image/png"), 25_000_000);
assert.equal(maxUploadBytes("audio/mpeg"), 80_000_000);
assert.equal(maxUploadBytes("video/mp4"), 500_000_000);
assert.equal(maxUploadBytes("application/octet-stream"), 0);

console.log("Asset policy smoke checks passed.");
