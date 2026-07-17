import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/audio-mix.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports });
const { musicMixEnvelope } = module.exports;
const closeTo = (value, expected) => assert.ok(Math.abs(value - expected) < 0.001, `${value} != ${expected}`);
const input = { totalFrames: 120, narrationRanges: [{ startFrame: 30, endFrame: 80 }] };

closeTo(musicMixEnvelope({ ...input, frame: 50, ducking: "off" }), 1);
closeTo(musicMixEnvelope({ ...input, frame: 50, ducking: "balanced" }), 0.38);
closeTo(musicMixEnvelope({ ...input, frame: 50, ducking: "strong" }), 0.2);
closeTo(musicMixEnvelope({ ...input, frame: 27, ducking: "balanced", attackFrames: 6 }), 0.69);
closeTo(musicMixEnvelope({ ...input, frame: 86, ducking: "balanced", releaseFrames: 12 }), 0.69);
closeTo(musicMixEnvelope({ ...input, frame: 0, ducking: "balanced" }), 0);
closeTo(musicMixEnvelope({ ...input, frame: 119, ducking: "balanced" }), 0);
closeTo(musicMixEnvelope({ ...input, frame: 20, ducking: "balanced" }), 1);

console.log("Audio mix smoke checks passed.");
