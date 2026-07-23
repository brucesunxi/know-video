import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/audio-quality.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require: () => ({}) });
const { assertUsableSpeechAudio, inspectAudio } = module.exports;

function wav(durationSeconds, amplitude, audibleSeconds = durationSeconds) {
  const sampleRate = 24_000;
  const sampleCount = Math.round(sampleRate * durationSeconds);
  const body = Buffer.alloc(44 + sampleCount * 2);
  body.write("RIFF", 0);
  body.writeUInt32LE(36 + sampleCount * 2, 4);
  body.write("WAVE", 8);
  body.write("fmt ", 12);
  body.writeUInt32LE(16, 16);
  body.writeUInt16LE(1, 20);
  body.writeUInt16LE(1, 22);
  body.writeUInt32LE(sampleRate, 24);
  body.writeUInt32LE(sampleRate * 2, 28);
  body.writeUInt16LE(2, 32);
  body.writeUInt16LE(16, 34);
  body.write("data", 36);
  body.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    body.writeInt16LE(index < sampleRate * audibleSeconds ? Math.round(Math.sin(index / 12) * amplitude) : 0, 44 + index * 2);
  }
  return body;
}

function mp3(frameCount = 24) {
  const frameLength = 144;
  const body = Buffer.alloc(frameLength * frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = frame * frameLength;
    body[offset] = 0xff;
    body[offset + 1] = 0xf3;
    body[offset + 2] = 0x64;
    body[offset + 3] = 0;
  }
  return body;
}

const healthy = wav(2, 5_000);
const inspected = inspectAudio(healthy);
assert.equal(inspected.format, "wav");
assert.ok(Math.abs(inspected.durationSeconds - 2) < 0.001);
assert.ok(inspected.rms > 0.05);
assert.ok(inspected.trailingSilenceSeconds < 0.05);
assert.doesNotThrow(() => assertUsableSpeechAudio(healthy, { targetDurationSeconds: 2.1 }));
assert.throws(() => assertUsableSpeechAudio(wav(2, 0)), /静音/);
assert.throws(() => assertUsableSpeechAudio(wav(4, 5_000, 0.8)), /后半段异常静音/);
assert.throws(() => assertUsableSpeechAudio(wav(0.1, 5_000)), /过短/);
assert.throws(() => assertUsableSpeechAudio(healthy, { targetDurationSeconds: 1 }), /过长/);
assert.throws(
  () => assertUsableSpeechAudio(wav(5, 5_000), { expectedTextDurationSeconds: 2 }),
  /语速异常缓慢或包含重复内容/
);
assert.doesNotThrow(
  () => assertUsableSpeechAudio(wav(3, 5_000), { expectedTextDurationSeconds: 2.2 })
);
assert.throws(() => assertUsableSpeechAudio(Buffer.from("not audio")), /无法解码/);

const inspectedMp3 = inspectAudio(mp3());
assert.equal(inspectedMp3.format, "mp3");
assert.equal(inspectedMp3.sampleRate, 24_000);
assert.equal(inspectedMp3.channels, 2);
assert.ok(inspectedMp3.durationSeconds > 0.5);

console.log("Audio quality smoke checks passed.");
