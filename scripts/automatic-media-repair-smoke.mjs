import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const audioRoute = fs.readFileSync(new URL("../app/api/assets/audio/generate/route.ts", import.meta.url), "utf8");
const generationRequests = fs.readFileSync(new URL("../lib/generation-requests.ts", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(workspace, /AUTOMATIC_MEDIA_REPAIR_ATTEMPTS = 3/);
assert.match(workspace, /generateImageScenesIndependently/);
assert.match(workspace, /sceneNumbers: \[sceneNumber\]/);
assert.match(workspace, /for \(let attempt = 0; attempt < 2 && !completed; attempt \+= 1\)/);
assert.match(workspace, /attempt < AUTOMATIC_MEDIA_REPAIR_ATTEMPTS && missingAudioSceneNumbers\.length > 0/);
assert.match(workspace, /missingImageSceneNumbers = missingSceneAssetNumbers/);
assert.match(workspace, /missingAudioSceneNumbers = missingSceneAssetNumbers/);
assert.match(workspace, /本次任务不会被标记为生成完成/);
assert.match(workspace, /const requiredMediaComplete = missingImageSceneNumbers\.length === 0 && missingAudioSceneNumbers\.length === 0/);
assert.match(workspace, /if \(requiredMediaComplete\) \{\s*setGenerationStartedAt\(undefined\);\s*clearPendingGenerationSession\(\);/);
assert.match(workspace, /if \(data\.generationOptions && missingRequiredMedia\)/);
assert.match(generationRequests, /status in \('pending', 'ready', 'failed'\)/);
assert.match(workspace, /if \(task\.projectId\) \{[\s\S]*await openProject\(task\.projectId, task\.id\)/);
assert.match(workspace, /async function dismissResolvedFailedTask\(requestId: string\)/);
assert.match(workspace, /resolvedFailedTaskId\?: string/);
assert.match(workspace, /if \(resolvedFailedTaskId\) await dismissResolvedFailedTask\(resolvedFailedTaskId\)/);
assert.match(workspace, /continueGeneratedProject\(\{\s*project: data\.project,/);
assert.ok(
  workspace.indexOf("if (resumeMissingOnly) {") < workspace.indexOf("let missingImageSceneNumbers"),
  "a recovered durable project must enter the studio before media repair starts"
);
assert.match(workspace, /if \(!resumeMissingOnly\) window\.setTimeout\(\(\) => setStage\("studio"\), 350\)/);
assert.match(audioRoute, /export const maxDuration = 300/);
assert.match(audioRoute, /系统将只针对失败场景继续自动补齐/);
assert.match(workspace, /function isRequiredMediaGenerationAction/);
assert.match(workspace, /className="kv-media-generation-banner"/);
assert.match(workspace, /!requiredMediaGenerationInProgress && \(exportBlockers/);
assert.match(workspace, /requiredMediaGenerating: requiredMediaGenerationInProgress/);
assert.match(styles, /\.kv-media-generation-banner/);

console.log("Automatic media repair smoke checks passed.");
