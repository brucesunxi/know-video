import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/operation-deadline.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports });
const { boundedOperationTimeout, OperationDeadlineExceededError } = module.exports;

assert.equal(boundedOperationTimeout({ operation: "test", maxTimeoutMs: 60_000 }), 60_000);
assert.equal(boundedOperationTimeout({
  operation: "test",
  deadlineMs: 20_000,
  nowMs: 10_000,
  reserveMs: 1_000,
  maxTimeoutMs: 60_000
}), 9_000);
assert.equal(boundedOperationTimeout({
  operation: "test",
  deadlineMs: 100_000,
  nowMs: 10_000,
  reserveMs: 5_000,
  maxTimeoutMs: 60_000
}), 60_000);
assert.throws(() => boundedOperationTimeout({
  operation: "speech",
  deadlineMs: 15_000,
  nowMs: 10_000,
  reserveMs: 4_000,
  minimumTimeoutMs: 2_000,
  maxTimeoutMs: 60_000
}), (error) => error instanceof OperationDeadlineExceededError);

const azure = fs.readFileSync(new URL("../lib/azure-speech.ts", import.meta.url), "utf8");
const audio = fs.readFileSync(new URL("../lib/audio-assets.ts", import.meta.url), "utf8");
const background = fs.readFileSync(new URL("../lib/background-media-generation.ts", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../app/api/assets/audio/generate/route.ts", import.meta.url), "utf8");

assert.match(azure, /maxAttempts = Math\.max\(1, Math\.min\(3/);
assert.match(azure, /signal: AbortSignal\.timeout\(timeoutMs\)/);
assert.match(azure, /deadlineMs: options\.deadlineMs/);
assert.match(audio, /new OpenAI\(\{ apiKey, timeout, maxRetries: 0 \}\)/);
assert.match(audio, /options\.allowOpenAIFallback === true/);
assert.match(audio, /ENABLE_OPENAI_TTS_FALLBACK/);
assert.match(background, /BACKGROUND_CALLBACK_WORK_DEADLINE_MS = 260_000/);
assert.match(background, /azureMaxAttempts: 1/);
assert.match(background, /allowOpenAIFallback: false/);
assert.match(route, /const requestWorkDeadline = Date\.now\(\) \+ 260_000/);
assert.doesNotMatch(route, /allowOpenAIFallback: true/);

console.log("Speech deadline and bounded fallback smoke checks passed.");
