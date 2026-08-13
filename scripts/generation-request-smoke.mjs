import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const source = fs.readFileSync(new URL("../lib/generation-requests.ts", import.meta.url), "utf8");
const projectsRoute = fs.readFileSync(new URL("../app/api/projects/route.ts", import.meta.url), "utf8");
const generationRoute = fs.readFileSync(new URL("../app/api/projects/generation/route.ts", import.meta.url), "utf8");
const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
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
assert.match(source, /userId: string/);
assert.match(source, /where id = \$\{id\} and user_id = \$\{userId\}/);
assert.match(source, /listIncompleteGenerationRequests/);
assert.match(source, /interval '15 minutes'/);
assert.match(source, /options_json jsonb/);
assert.match(source, /options\?: GenerationOptions/);
assert.match(projectsRoute, /after\(\(\) => runBackgroundGeneration/);
assert.match(projectsRoute, /return NextResponse\.json\(\{ status: "pending", requestId \}, \{ status: 202 \}\)/);
assert.match(projectsRoute, /listIncompleteGenerationRequests\(user\.id\)/);
assert.match(generationRoute, /getGenerationRequest\(parsed\.data, user\.id\)/);
assert.match(schema, /generation_requests \([\s\S]*?user_id uuid references users\(id\)/);
assert.match(schema, /generation_requests \([\s\S]*?options_json jsonb/);
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
assert.match(workspace, /aria-label=\{text\("生成前审阅清单", "Pre-generation review checklist"\)\}/);
assert.match(workspace, /生成前审阅/);
assert.match(workspace, /需求完整度/);
assert.match(workspace, /分镜节奏/);
assert.match(workspace, /动态成本/);
assert.match(workspace, /最高预估/);
assert.match(workspace, /costConsent: true/);
assert.match(workspace, /billingRequestId: crypto\.randomUUID\(\)/);
assert.match(workspace, /window\.localStorage\.setItem\(PENDING_GENERATION_STORAGE_KEY/);
assert.match(workspace, /generationRequests\?: GenerationTaskListItem\[\]/);
assert.match(workspace, /function generationTaskTitle\(task: GenerationTaskListItem, language: UiLanguage\)/);
assert.match(workspace, /function generationTaskSpecs\(task: GenerationTaskListItem, language: UiLanguage\)/);
assert.match(workspace, /function openGenerationTask\(task: GenerationTaskListItem\)/);
assert.match(workspace, /onOpenGeneration: \(task: GenerationTaskListItem\) => void/);
assert.match(workspace, /查看进度/);
assert.match(workspace, /localizedGenerationPrompt\(task\.prompt\?\.trim\(\) \?\? "", language\)/);
assert.match(workspace, /waitForGenerationRequest\(task\.id/);
assert.match(workspace, /task\.options \?\? generationOptions/);
assert.match(workspace, /recoveringGenerationRequestIdRef\.current === task\.id/);
assert.match(workspace, /setStage\("generating"\);\s+return;/);
assert.match(workspace, /setPendingVideoGeneration/);
assert.match(workspace, /约 \$\{secondsPerScene\} 秒\/幕/);
assert.match(workspace, /label: "旁白语言"/);
assert.match(workspace, /脚本和旁白会按此语言生成/);
assert.match(styles, /\.kv-generation-review/);
assert.match(styles, /\.kv-generation-review span\.attention/);
assert.match(styles, /\.kv-generation-review span\.working/);
assert.match(styles, /\.kv-generation-review b/);
assert.match(styles, /\.kv-generation-task-open/);
assert.match(styles, /\.kv-generation-task-action/);
assert.match(styles, /\.kv-generation-task-specs em/);

console.log("Generation request smoke checks passed.");
