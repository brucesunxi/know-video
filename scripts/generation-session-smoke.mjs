import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/generation-session.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require: () => ({}) });
const { parsePendingGenerationSession, PENDING_GENERATION_MAX_AGE_MS } = module.exports;

const now = 1_800_000_000_000;
const valid = {
  requestId: "34df4d78-41f1-4e28-9ac5-7e70df24fa15",
  prompt: "  生成一个产品介绍视频  ",
  options: { duration: "30", sceneCount: "5", language: "中文", style: "电影质感", motion: "key-scenes", videoTier: "economy" },
  startedAt: now - 30_000
};
const parsed = parsePendingGenerationSession(JSON.stringify(valid), now);
assert.equal(parsed.prompt, "生成一个产品介绍视频");
assert.equal(parsed.requestId, valid.requestId);
assert.equal(parsePendingGenerationSession(JSON.stringify({ ...valid, requestId: "bad" }), now), undefined);
assert.equal(parsePendingGenerationSession(JSON.stringify({ ...valid, startedAt: now - PENDING_GENERATION_MAX_AGE_MS - 1 }), now), undefined);
assert.equal(parsePendingGenerationSession(JSON.stringify({ ...valid, options: { ...valid.options, videoTier: "unlimited" } }), now), undefined);
assert.equal(parsePendingGenerationSession("not-json", now), undefined);

console.log("Generation session smoke checks passed.");
