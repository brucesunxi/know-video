import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/video-quality.ts", import.meta.url), "utf8")
  .replace('import { parseMedia } from "@remotion/media-parser";', 'const { parseMedia } = require("@remotion/media-parser");');
const output = ts.transpileModule(source, {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, {
  Blob,
  Buffer,
  module,
  exports: module.exports,
  require: (specifier) => specifier === "@remotion/media-parser"
    ? { parseMedia: async () => ({}) }
    : {}
});
const { assessGeneratedVideoMetadata, inspectGeneratedVideo } = module.exports;

const valid = assessGeneratedVideoMetadata({
  container: "mp4",
  duration: 7.96,
  width: 1280,
  height: 720,
  fps: 30,
  codec: "h264",
  size: 900_000,
  requestedDuration: 8
});
assert.equal(valid.duration, 7.96);
assert.equal(valid.requestedDuration, 8);
assert.equal(valid.width, 1280);

assert.throws(() => assessGeneratedVideoMetadata({
  container: "mp4",
  duration: 3,
  width: 1280,
  height: 720,
  fps: 30,
  codec: "h264",
  size: 900_000,
  requestedDuration: 8
}), /时长/);
assert.throws(() => assessGeneratedVideoMetadata({
  container: "mp4",
  duration: 8,
  width: 512,
  height: 288,
  fps: 30,
  codec: "h264",
  size: 900_000,
  requestedDuration: 8
}), /分辨率/);
assert.throws(() => assessGeneratedVideoMetadata({
  container: "mp4",
  duration: 8,
  width: 1280,
  height: 720,
  fps: 30,
  codec: "h265",
  size: 900_000,
  requestedDuration: 8
}), /H\.264/);
await assert.rejects(() => inspectGeneratedVideo(Buffer.alloc(1024), 5), /文件过小/);

console.log("Generated video quality smoke checks passed.");
