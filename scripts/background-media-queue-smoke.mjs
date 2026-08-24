import assert from "node:assert/strict";
import fs from "node:fs";

const projectRoute = fs.readFileSync(new URL("../app/api/projects/route.ts", import.meta.url), "utf8");
const queue = fs.readFileSync(new URL("../lib/media-generation-queue.ts", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../lib/background-media-generation.ts", import.meta.url), "utf8");
const consumer = fs.readFileSync(new URL("../app/api/queues/project-media/route.ts", import.meta.url), "utf8");
const requests = fs.readFileSync(new URL("../lib/generation-requests.ts", import.meta.url), "utf8");
const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

assert.match(projectRoute, /attachGenerationRequestProject/);
assert.match(projectRoute, /enqueueProjectMediaScene\(\{/);
assert.match(queue, /send\(PROJECT_MEDIA_TOPIC/);
assert.match(queue, /idempotencyKey: `\$\{message\.requestId\}:scene:\$\{message\.sceneNumber\}`/);
assert.match(worker, /if \(sceneAsset\(project, message\.sceneNumber, "image"\)\) return project/);
assert.match(worker, /if \(sceneAsset\(project, message\.sceneNumber, "audio"\)\) return project/);
assert.match(worker, /enqueueProjectMediaScene\(\{ \.\.\.message, sceneNumber: nextSceneNumber \}\)/);
assert.match(worker, /completeGenerationRequest/);
assert.match(worker, /automaticPremiumUpgrade = deliveryCount >= 2/);
assert.match(worker, /ProjectMediaQualityExhaustedError/);
assert.match(worker, /ensureSceneImage\(message, project, deliveryCount\)/);
assert.match(worker, /allowStyleFallback: automaticPremiumUpgrade/);
assert.match(worker, /候选画面均未通过内容与风格质量检查/);
assert.match(consumer, /processProjectMediaScene\(message, metadata\.deliveryCount\)/);
assert.match(consumer, /error instanceof ProjectMediaQualityExhaustedError/);
assert.match(consumer, /metadata\.deliveryCount >= 2/);
assert.match(consumer, /metadata\.deliveryCount >= 4/);
assert.match(requests, /ATTACHED_PROJECT_STALE_INTERVAL = "45 minutes"/);
assert.equal(
  vercel.functions["app/api/queues/project-media/route.ts"].experimentalTriggers[0].topic,
  "project-media-generation"
);

console.log("Background media queue smoke checks passed.");
