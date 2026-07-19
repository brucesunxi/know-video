import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const source = fs.readFileSync(new URL("../lib/generation-requests.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, {
  module,
  exports: module.exports,
  require: (id) => {
    if (id === "node:crypto") return { createHash };
    if (id === "@/lib/db") return { getSql: () => undefined, hasDatabaseUrl: () => false };
    return {};
  }
});

const { generationRequestFingerprint } = module.exports;
assert.match(source, /failGenerationRequest\(id: string, error =/);
assert.match(source, /safeError/);
const options = {
  duration: "30",
  sceneCount: "5",
  language: "中文",
  style: "电影质感",
  motion: "key-scenes",
  videoTier: "economy"
};
const first = generationRequestFingerprint("  生成产品介绍视频  ", options);
const second = generationRequestFingerprint("生成产品介绍视频", options);
const changedPrompt = generationRequestFingerprint("生成教育产品介绍视频", options);
const changedStyle = generationRequestFingerprint("生成产品介绍视频", { ...options, style: "极简高级" });
const withReference = generationRequestFingerprint("生成产品介绍视频", options, [{
  key: "uploads/generation/34df4d78/reference.png",
  name: "reference.png",
  size: 1234,
  contentType: "image/png"
}]);

assert.match(first, /^[a-f0-9]{64}$/);
assert.equal(first, second);
assert.notEqual(first, changedPrompt);
assert.notEqual(first, changedStyle);
assert.notEqual(first, withReference);

assert.match(workspace, /function plannedSceneCount/);
assert.match(workspace, /function generationReviewItems/);
assert.match(workspace, /const reviewItems = generationReviewItems\(prompt, options\)/);
assert.match(workspace, /aria-label="生成前审阅清单"/);
assert.match(workspace, /生成前审阅/);
assert.match(workspace, /需求完整度/);
assert.match(workspace, /分镜节奏/);
assert.match(workspace, /动态成本/);
assert.match(workspace, /最高预估/);
assert.match(workspace, /失败不自动扣费重试/);
assert.match(workspace, /costConsent: true/);
assert.match(workspace, /setPendingVideoGeneration/);
assert.match(workspace, /语言与风格/);
assert.match(workspace, /约 \$\{secondsPerScene\} 秒\/幕/);
assert.match(workspace, /脚本、旁白、画面提示词会按此规格统一/);
assert.match(styles, /\.kv-generation-review/);
assert.match(styles, /\.kv-generation-review span\.attention/);
assert.match(styles, /\.kv-generation-review span\.working/);
assert.match(styles, /\.kv-generation-review b/);

console.log("Generation request smoke checks passed.");
