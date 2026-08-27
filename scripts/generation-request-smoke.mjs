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
const reconciliation = fs.readFileSync(new URL("../lib/generation-reconciliation.ts", import.meta.url), "utf8");
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
assert.match(source, /export async function failGenerationRequest\(input: \{/);
assert.match(source, /safeError/);
assert.match(source, /userId: string/);
assert.match(source, /where request\.id = \$\{id\} and request\.user_id = \$\{userId\}/);
assert.match(source, /listIncompleteGenerationRequests/);
assert.match(source, /deleteFailedGenerationRequest/);
assert.match(source, /status = 'failed'/);
assert.match(source, /PLANNING_STALE_INTERVAL/);
assert.match(source, /GENERATION_MAX_RUNTIME_MINUTES/);
assert.match(source, /sql\.transaction\(\[/);
assert.match(source, /buildCreditReservationReleaseQuery/);
assert.match(source, /buildCreditReservationRefundQuery/);
assert.match(source, /pg_advisory_xact_lock/);
assert.doesNotMatch(source, /create table|alter table|create (?:unique )?index/i);
assert.match(source, /options\?: GenerationOptions/);
assert.match(projectsRoute, /after\(\(\) => runBackgroundGeneration/);
assert.match(projectsRoute, /attachGenerationRequestProject/);
assert.match(projectsRoute, /enqueueProjectMediaScene/);
assert.match(projectsRoute, /await enqueueProjectGenerationWatchdog\(\{/);
assert.ok(
  projectsRoute.indexOf("await enqueueProjectGenerationWatchdog({")
    < projectsRoute.indexOf("after(() => runBackgroundGeneration")
);
assert.ok(
  projectsRoute.indexOf("await enqueueProjectGenerationWatchdog({")
    < projectsRoute.indexOf("const reservation = await reserveCredits({")
);
assert.match(projectsRoute, /return NextResponse\.json\(\{ status: "pending", requestId \}, \{ status: 202 \}\)/);
assert.match(projectsRoute, /listIncompleteGenerationRequests\(user\.id\)/);
assert.match(projectsRoute, /listCompletedPendingGenerationRequests\(user\.id\)/);
assert.match(projectsRoute, /reconcileCompletedGenerationRequests\(candidates, user\.id\)/);
assert.match(generationRoute, /getGenerationRequest\(parsed\.data, user\.id\)/);
assert.match(generationRoute, /getGenerationRequestBeforeExpiry\(parsed\.data, user\.id\)/);
assert.match(generationRoute, /reconcileCompletedGenerationRequest/);
assert.match(generationRoute, /sceneHasAudioAsset/);
assert.match(generationRoute, /listCompletedPendingGenerationRequests\(user\.id\)/);
assert.match(generationRoute, /if \(!requestId\)/);
assert.match(generationRoute, /const incomplete = await listIncompleteGenerationRequests\(user\.id\)/);
assert.match(generationRoute, /generationRequests: await recoverStalledGenerationRequests\(incomplete, user\.id\)/);
assert.match(reconciliation, /sceneHasVisualAsset\(scene\) && sceneHasAudioAsset\(scene\)/);
assert.match(reconciliation, /releaseReason: "project_generation_reconciled"/);
assert.match(reconciliation, /recoverStalledGenerationRequest/);
assert.match(reconciliation, /generationMediaIsInactive/);
assert.match(reconciliation, /resumeAttempt/);
assert.match(reconciliation, /enqueueProjectMediaScene/);
assert.match(source, /not exists \([\s\S]*?scene_assets visual_asset/);
assert.match(source, /scene_assets audio_asset/);
assert.match(generationRoute, /export async function DELETE/);
assert.match(generationRoute, /deleteFailedGenerationRequest\(parsed\.data, user\.id\)/);
assert.match(schema, /generation_requests \([\s\S]*?user_id uuid references users\(id\)/);
assert.match(schema, /generation_requests \([\s\S]*?options_json jsonb/);
assert.match(source, /operator is not unique/);
assert.match(source, /buildCreditReservationRefundQuery/);
assert.match(source, /refundReason: row\.status === "failed"/);
const options = {
  duration: "30",
  sceneCount: "5",
  language: "中文",
  style: "电影质感",
  motion: "stock"
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
assert.match(workspace, /function defaultGenerationOptions\(prompt = ""\)/);
assert.match(workspace, /function resolvedGenerationOptions\(prompt: string, options: GenerationOptions\)/);
assert.match(workspace, /visualStyleSource: source/);
assert.match(projectsRoute, /visualStyleSource: z\.enum\(\["auto", "template", "manual"\]\)\.optional\(\)/);
assert.match(workspace, /const reviewItems = generationReviewItems\(prompt, options\)/);
assert.match(workspace, /aria-label=\{text\("生成前审阅清单", "Pre-generation review checklist"\)\}/);
assert.match(workspace, /生成前审阅/);
assert.match(workspace, /需求完整度/);
assert.match(workspace, /分镜节奏/);
assert.match(workspace, /动态成本/);
assert.match(workspace, /动态素材剪辑（免费）/);
assert.match(workspace, /不调用付费视频模型/);
assert.match(workspace, /\/api\/assets\/video\/stock/);
assert.doesNotMatch(workspace, /生成关键动态镜头（额外计费）/);
assert.match(workspace, /window\.localStorage\.setItem\(PENDING_GENERATION_STORAGE_KEY/);
assert.match(workspace, /generationRequests\?: GenerationTaskListItem\[\]/);
assert.match(workspace, /function generationTaskTitle\(task: GenerationTaskListItem, language: UiLanguage\)/);
assert.match(workspace, /function generationTaskSpecs\(task: GenerationTaskListItem, language: UiLanguage\)/);
assert.match(workspace, /function generationTaskProgressLabel\(task: GenerationTaskListItem, language: UiLanguage, background = false\)/);
assert.match(workspace, /did not pass the visual content and style checks after automatic retries/);
assert.match(workspace, /if \(task\.projectId\)/);
assert.match(workspace, /正在后台生成场景画面与配音/);
assert.match(workspace, /Generating scene visuals and narration in the background/);
assert.match(workspace, /离开当前页面不会中断视频生成/);
assert.doesNotMatch(workspace, /Untitled video generation/);
assert.match(workspace, /历史视频生成任务/);
assert.match(workspace, /options\?\.visualStyleLabel\?\.trim\(\)/);
assert.match(workspace, /briefVisualStyleEnglish\[options\.visualStyleId\]/);
assert.match(workspace, /Intl\.DateTimeFormat/);
assert.match(source, /set prompt = coalesce\(prompt,/);
const taskPromptDivider = /\n|(?:Apply|Use) the [“"].+?[”"] (?:template )?style:|应用[“"].+?[”"](?:模板)?风格[：:]/u;
assert.equal(
  'Create a safety briefing. Apply the “Job-site safety briefing” template style: Cinematic documentary.'.split(taskPromptDivider)[0],
  "Create a safety briefing. "
);
assert.equal(
  '制作工地安全简报。应用“工地安全”模板风格：电影纪实。'.split(taskPromptDivider)[0],
  "制作工地安全简报。"
);
assert.match(workspace, /function openGenerationTask\(task: GenerationTaskListItem\)/);
assert.match(workspace, /setGenerationOptions\(resolvedGenerationOptions\(prompt, task\.options \?\? defaultGenerationOptions\(prompt\)\)\)/);
assert.match(workspace, /setGenerationOptions\(defaultGenerationOptions\(\)\)/);
assert.match(workspace, /const submittedOptions = resolvedGenerationOptions\(generationPrompt, generationOptions\)/);
assert.match(workspace, /options: submittedOptions/);
assert.match(workspace, /JSON\.stringify\(\{ prompt, options: submittedOptions/);
assert.match(workspace, /updatePrompt\(card\.title === "Explain a concept"/);
assert.doesNotMatch(workspace, /onUseExample/);
assert.match(workspace, /onOpenGeneration: \(task: GenerationTaskListItem\) => void/);
assert.match(workspace, /刷新状态/);
assert.match(workspace, /localizedGenerationPrompt\(task\.prompt\?\.trim\(\) \?\? "", language\)/);
assert.match(workspace, /\/api\/projects\/generation\?requestId=/);
assert.match(workspace, /data\.status === "ready" && data\.project/);
assert.match(workspace, /await openProject\(data\.project\.id\)/);
assert.doesNotMatch(workspace, /async function waitForGenerationRequest/);
assert.match(workspace, /setPendingVideoGeneration/);
assert.match(workspace, /className=\{`kv-task-bell/);
assert.match(workspace, /生成任务中心/);
assert.match(workspace, /const \[taskFilter, setTaskFilter\]/);
assert.match(workspace, /function deleteGenerationTask\(task: GenerationTaskListItem\)/);
assert.match(workspace, /删除这条失败提示/);
assert.match(workspace, /hasRunningGenerationTasks\s*\? window\.setInterval\(\(\) => void refreshTasks\(\), 15_000\)\s*:\s*undefined/);
assert.match(workspace, /stage === "projects" && !hasRunningGenerationTasks/);
assert.match(workspace, /setGenerationStatus\("任务已转入后台生成"\)/);
assert.match(workspace, /await openProjects\(\);\s+return;/);
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
assert.match(styles, /\.kv-task-center-list/);
assert.match(styles, /\.kv-generation-task-filters/);

console.log("Generation request smoke checks passed.");
