import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const audioRoute = fs.readFileSync(new URL("../app/api/assets/audio/generate/route.ts", import.meta.url), "utf8");

assert.match(workspace, /AUTOMATIC_MEDIA_REPAIR_ATTEMPTS = 3/);
assert.match(workspace, /attempt < AUTOMATIC_MEDIA_REPAIR_ATTEMPTS && missingImageSceneNumbers\.length > 0/);
assert.match(workspace, /attempt < AUTOMATIC_MEDIA_REPAIR_ATTEMPTS && missingAudioSceneNumbers\.length > 0/);
assert.match(workspace, /missingImageSceneNumbers = missingSceneAssetNumbers/);
assert.match(workspace, /missingAudioSceneNumbers = missingSceneAssetNumbers/);
assert.match(workspace, /本次任务不会被标记为生成完成/);
assert.ok(
  workspace.indexOf("if (resumeMissingOnly) {") < workspace.indexOf("let missingImageSceneNumbers"),
  "a recovered durable project must enter the studio before media repair starts"
);
assert.match(workspace, /if \(!resumeMissingOnly\) window\.setTimeout\(\(\) => setStage\("studio"\), 350\)/);
assert.match(audioRoute, /export const maxDuration = 300/);
assert.match(audioRoute, /系统将只针对失败场景继续自动补齐/);

console.log("Automatic media repair smoke checks passed.");
