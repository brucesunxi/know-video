import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/uploaded-narration.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
let configured = true;
let targetDuration;
const module = { exports: {} };
vm.runInNewContext(output, {
  Buffer,
  module,
  exports: module.exports,
  require: (specifier) => {
    if (specifier === "@/lib/audio-quality") return {
      assertUsableSpeechAudio: (_body, options) => {
        targetDuration = options.targetDurationSeconds;
        return { durationSeconds: 4.2 };
      }
    };
    if (specifier === "@/lib/cloudflare-ai") return {
      hasCloudflareAI: () => configured,
      transcribeCloudflareAudio: async () => ({ transcript: "同步后的场景旁白。", model: "whisper-test" })
    };
    throw new Error(`Unexpected import: ${specifier}`);
  }
});

const { inspectUploadedNarration } = module.exports;
const result = await inspectUploadedNarration(Buffer.from("audio"), 6);
assert.equal(targetDuration, 6);
assert.equal(result.actualDurationSeconds, 4.2);
assert.equal(result.transcript, "同步后的场景旁白。");
assert.equal(result.transcriptionModel, "whisper-test");

configured = false;
await assert.rejects(() => inspectUploadedNarration(Buffer.from("audio"), 6), /语音识别服务配置/);

console.log("Uploaded narration smoke checks passed.");
