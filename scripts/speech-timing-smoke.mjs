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
  correctedSpeechRate,
  estimateCbrMp3Duration,
  estimateNarrationSeconds,
  speechRateForDuration
} = module.exports;

assert.ok(estimateNarrationSeconds("这是自然中文旁白。") > 1);
assert.ok(speechRateForDuration("这是一段明显比较长的中文旁白，需要在很短的时间内读完。", 3) > 0);
assert.equal(speechRateForDuration("短句。", 10), -20);
assert.equal(correctedSpeechRate(20, 6, 5), 44);
assert.equal(correctedSpeechRate(40, 10, 2), 45);
assert.equal(correctedSpeechRate(0, 4, 6), -20);

const azure = fs.readFileSync(new URL("../lib/azure-speech.ts", import.meta.url), "utf8");
assert.match(azure, /timingRatio < 0\.82/);
assert.match(azure, /nextRate !== rate/);

const audioAssets = fs.readFileSync(new URL("../lib/audio-assets.ts", import.meta.url), "utf8");
assert.match(audioAssets, /旁白内容过长/);
assert.match(audioAssets, /scene\.durationSeconds \* 0\.86/);

const rawAudio = Buffer.alloc(48_000 / 8 * 5);
assert.ok(Math.abs(estimateCbrMp3Duration(rawAudio, 48) - 5) < 0.001);
const id3Header = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 20]);
const tagged = Buffer.concat([id3Header, Buffer.alloc(20), rawAudio]);
assert.ok(Math.abs(estimateCbrMp3Duration(tagged, 48) - 5) < 0.001);

console.log("Speech timing smoke checks passed.");
