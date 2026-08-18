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
assert.match(consumer, /metadata\.deliveryCount >= 6/);
assert.match(requests, /interval '24 hours'/);
assert.equal(
  vercel.functions["app/api/queues/project-media/route.ts"].experimentalTriggers[0].topic,
  "project-media-generation"
);

console.log("Background media queue smoke checks passed.");
