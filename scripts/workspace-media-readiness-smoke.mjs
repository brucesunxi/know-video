import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(workspace, /function sceneNumberListLabel/);
assert.match(workspace, /type InvalidRenderMedia/);
assert.match(workspace, /type GenerationMediaIssue/);
assert.match(workspace, /function invalidRenderMediaSummary/);
assert.match(workspace, /function generationIssueSummary/);
assert.match(workspace, /setGenerationIssues\(issues\)/);
assert.match(workspace, /withoutRepairedGenerationIssues/);
assert.match(workspace, /invalidMedia\?: InvalidRenderMedia\[\]/);
assert.match(workspace, /generationIssues: GenerationMediaIssue\[\]/);
assert.match(workspace, /setInvalidRenderMedia\(data\.invalidMedia\)/);
assert.doesNotMatch(workspace, /aria-label="成片素材检查"/);
assert.doesNotMatch(workspace, /aria-label="云端素材异常"/);
assert.match(workspace, /onRegenerate\(missingSceneNumbers\)/);
assert.match(workspace, /onRegenerateAudio\(missingAudioSceneNumbers\)/);
assert.match(workspace, /onRegenerate\(invalidMedia\.visual\)/);
assert.match(workspace, /onRegenerateAudio\(invalidMedia\.audio\)/);
assert.match(workspace, /invalidMediaCount: invalidRenderMedia\.length \+ qualityErrors\.length/);
assert.match(workspace, /auditProjectMedia\(project\)/);
assert.match(workspace, /aria-label="成片质量异常"/);
assert.match(workspace, /替换停帧镜头：场景/);
assert.match(workspace, /aria-label="生成未完成素材"/);
assert.match(workspace, /刚才有 \{generationIssueCount\} 个素材没有生成完成/);
assert.match(workspace, /重试画面：场景 \{sceneNumberListLabel\(generationIssue\.visual\)\}/);
assert.match(workspace, /重试配音：场景 \{sceneNumberListLabel\(generationIssue\.audio\)\}/);
assert.match(workspace, /重试动态镜头：场景 \{sceneNumberListLabel\(generationIssue\.clip\)\}/);
assert.doesNotMatch(workspace, /kv-media-warning/);

assert.match(styles, /\.kv-media-readiness/);
assert.match(styles, /\.kv-media-readiness-danger/);
assert.match(styles, /\.kv-media-readiness-retry/);
assert.match(styles, /\.kv-media-readiness-actions/);
assert.match(styles, /\.kv-export-blocker-list button/);
assert.doesNotMatch(styles, /\.kv-media-warning/);

console.log("Workspace media readiness smoke checks passed.");
