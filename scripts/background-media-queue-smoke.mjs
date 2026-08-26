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
assert.match(queue, /recoveryPass\?: number/);
assert.match(queue, /idempotencyKey: `\$\{message\.requestId\}:pass:\$\{message\.recoveryPass \?\? 0\}:scene:\$\{message\.sceneNumber\}`/);
assert.match(worker, /if \(sceneAsset\(project, message\.sceneNumber, "image"\)\) return project/);
assert.match(worker, /if \(sceneAsset\(project, message\.sceneNumber, "audio"\)\) return project/);
assert.match(worker, /enqueueProjectMediaScene\(\{ \.\.\.message, sceneNumber: nextSceneNumber \}\)/);
assert.match(worker, /completeGenerationRequest/);
assert.match(worker, /const completionRescue = deliveryCount >= 2/);
assert.match(worker, /const requiresPremium = Boolean/);
assert.match(worker, /let quality[^=]*= requiresPremium \|\| completionRescue/);
assert.match(worker, /error instanceof InsufficientCreditsError/);
assert.match(worker, /continuing with the funded standard model/);
assert.match(worker, /ProjectMediaQualityExhaustedError/);
assert.match(worker, /ensureSceneImage\(message, project, deliveryCount\)/);
assert.match(worker, /let imageError: unknown/);
assert.match(worker, /project = await ensureSceneNarration\(message, project\)/);
assert.match(worker, /if \(imageError && \(!refreshedScene \|\| !sceneHasVisualAsset\(refreshedScene\)\)\) throw imageError/);
assert.match(worker, /if \(narrationError && \(!refreshedScene \|\| !sceneHasAudioAsset\(refreshedScene\)\)\) throw narrationError/);
assert.match(worker, /free stock lookup failed; local motion remains active/);
assert.match(worker, /allowStyleFallback: completionRescue/);
assert.match(worker, /allowCompletionFallback: completionRescue/);
assert.match(worker, /hard text-free gate/);
assert.match(worker, /background-\$\{quality\}-completion-rescue-\$\{deliveryCount\}/);
assert.match(worker, /maxQualityAttempts: completionRescue \? 2 : 3/);
assert.match(worker, /qualityGate: generated\.metadata\?\.qualityGate/);
assert.match(worker, /completionFallbackReason: generated\.metadata\?\.completionFallbackReason/);
assert.match(worker, /const recoveryPass = \(message\.recoveryPass \?\? 0\) \+ 1/);
assert.match(worker, /recoveryPass > 2/);
assert.match(worker, /sceneNumber: first\.sceneNumber,[\s\S]*recoveryPass/);
assert.match(worker, /候选画面均未通过内容与风格质量检查/);
assert.match(consumer, /processProjectMediaScene\(message, metadata\.deliveryCount\)/);
assert.match(consumer, /error instanceof ProjectMediaQualityExhaustedError/);
assert.match(consumer, /metadata\.deliveryCount >= 3/);
assert.match(consumer, /metadata\.deliveryCount >= 4/);
assert.match(requests, /ATTACHED_PROJECT_STALE_INTERVAL = "45 minutes"/);
assert.equal(
  vercel.functions["app/api/queues/project-media/route.ts"].experimentalTriggers[0].topic,
  "project-media-generation"
);

console.log("Background media queue smoke checks passed.");
