import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/speech-timing.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require: () => ({}) });
const {
  estimateCbrMp3Duration,
  estimateNarrationSeconds
} = module.exports;

assert.ok(estimateNarrationSeconds("这是自然中文旁白。") > 1);

const azure = fs.readFileSync(new URL("../lib/azure-speech.ts", import.meta.url), "utf8");
assert.match(azure, /expectedTextDurationSeconds/);
assert.doesNotMatch(azure, /speechRateForDuration|correctedSpeechRate|rateOffset/);
assert.doesNotMatch(azure, /<prosody rate=/);
assert.match(azure, /rate: 0/);

const audioAssets = fs.readFileSync(new URL("../lib/audio-assets.ts", import.meta.url), "utf8");
assert.doesNotMatch(audioAssets, /scene\.durationSeconds \* 0\.86/);
assert.doesNotMatch(audioAssets, /narration was shortened/);
assert.doesNotMatch(audioAssets, /complete in about/);
assert.match(audioAssets, /Do not speed up or slow down/);
assert.match(audioAssets, /TTS_GENERATION_CONCURRENCY"\)\) \|\| 2/);

const narrationFit = fs.readFileSync(new URL("../lib/narration-fit.ts", import.meta.url), "utf8");
assert.match(narrationFit, /options\.preserveNarration/);
assert.match(narrationFit, /return fitScenesNarration\(scenes, targetDuration\)/);

const rawAudio = Buffer.alloc(48_000 / 8 * 5);
assert.ok(Math.abs(estimateCbrMp3Duration(rawAudio, 48) - 5) < 0.001);
const id3Header = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 20]);
const tagged = Buffer.concat([id3Header, Buffer.alloc(20), rawAudio]);
assert.ok(Math.abs(estimateCbrMp3Duration(tagged, 48) - 5) < 0.001);

console.log("Speech timing smoke checks passed.");
