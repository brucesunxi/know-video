import assert from "node:assert/strict";
import fs from "node:fs";

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const usage = fs.readFileSync(new URL("../lib/billing/usage.ts", import.meta.url), "utf8");
const accounts = fs.readFileSync(new URL("../lib/billing/accounts.ts", import.meta.url), "utf8");
const projects = fs.readFileSync(new URL("../app/api/projects/route.ts", import.meta.url), "utf8");
const background = fs.readFileSync(new URL("../lib/background-media-generation.ts", import.meta.url), "utf8");
const generationRequests = fs.readFileSync(new URL("../lib/generation-requests.ts", import.meta.url), "utf8");
const images = fs.readFileSync(new URL("../lib/image-assets.ts", import.meta.url), "utf8");
const audioRoute = fs.readFileSync(new URL("../app/api/assets/audio/generate/route.ts", import.meta.url), "utf8");
const videoRoute = fs.readFileSync(new URL("../app/api/assets/video/generate/route.ts", import.meta.url), "utf8");
const estimateRoute = fs.readFileSync(new URL("../app/api/billing/estimate/route.ts", import.meta.url), "utf8");
const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");

assert.match(schema, /create table if not exists credit_reservations/);
assert.match(schema, /create table if not exists provider_cost_events/);
assert.match(schema, /reservation_id uuid references credit_reservations/);
assert.match(accounts, /reservedCredits/);
assert.match(accounts, /reservation_expired/);

assert.match(usage, /export async function reserveCredits/);
assert.doesNotMatch(usage, /create table|alter table|create (?:unique )?index/i);
assert.match(usage, /available_credits = account\.available_credits -/);
assert.match(usage, /reserved_credits = account\.reserved_credits \+/);
assert.match(usage, /'reserve_adjustment', -\(\$\{input\.credits\}::bigint\)/);
assert.doesNotMatch(usage, /'reserve_adjustment', -\$\{input\.credits\}/);
assert.match(usage, /lifetime_consumed = account\.lifetime_consumed \+/);
assert.match(usage, /export async function releaseCreditReservation/);
assert.match(usage, /export async function refundCreditReservation/);
assert.match(usage, /export function buildCreditReservationReleaseQuery/);
assert.match(usage, /export function buildCreditReservationRefundQuery/);
assert.match(usage, /from generation_requests generation/);
assert.match(usage, /event\.status = 'settled'/);
assert.match(usage, /set status = 'released',[\s\S]*settled_credits = 0/);
assert.match(usage, /available_credits = account\.available_credits \+ refunded\.refund_credits/);
assert.match(usage, /lifetime_consumed = greatest\(0, account\.lifetime_consumed - refunded\.consumed_credits_refund\)/);
assert.match(usage, /'generation_refund'/);
assert.match(usage, /on conflict \(idempotency_key\) do nothing/);

assert.match(projects, /projectEstimateItems/);
assert.match(projects, /reserveCredits\(\{/);
assert.match(projects, /INSUFFICIENT_CREDITS/);
assert.match(projects, /operator is not unique/);
assert.match(projects, /failGenerationRequest\(\{[\s\S]*refundReason: "project_generation_failed"/);
assert.doesNotMatch(projects, /refundCreditReservation|releaseCreditReservation/);
assert.match(background, /reservationKey: message\.billingReservationKey/);
assert.match(background, /project_generation_completed/);
assert.match(background, /project_media_permanently_failed/);
assert.match(background, /failGenerationRequest\(\{[\s\S]*refundReason: "project_media_permanently_failed"/);
assert.match(background, /completeGenerationRequest\(\{[\s\S]*releaseReason: "project_generation_completed"/);
assert.doesNotMatch(background, /refundCreditReservation|releaseCreditReservation/);
assert.match(background, /automaticPremiumUpgrade/);
assert.match(generationRequests, /sql\.transaction\(\[/);
assert.match(generationRequests, /buildCreditReservationReleaseQuery\(sql/);
assert.match(generationRequests, /buildCreditReservationRefundQuery\(sql/);
assert.match(generationRequests, /status: "ready"/);
assert.match(generationRequests, /status: "failed"/);

assert.match(images, /providerRequestCount/);
assert.match(images, /validationRequestCount/);
assert.match(images, /recordProviderCostAttempt/);
assert.match(images, /internalRetriesNotCharged|estimatedActualCostUsd/);
assert.match(audioRoute, /scene:\$\{usage\.scene\.sceneNumber\}/);
assert.match(audioRoute, /audio_generation_exception/);
assert.match(videoRoute, /scene:\$\{sceneNumber\}/);
assert.match(videoRoute, /video_generation_exception/);
assert.match(estimateRoute, /balanceSufficient/);
assert.match(estimateRoute, /shortfallCredits/);
assert.match(workspace, /function creditShortfallFromError/);
assert.match(workspace, /余额不足，还差/);
assert.match(workspace, /充值后请重新提交；失败任务不会扣费/);
assert.match(workspace, /know-video:open-credits/);

for (const route of [
  "../app/api/assets/generate/route.ts",
  "../app/api/assets/audio/generate/route.ts",
  "../app/api/assets/video/generate/route.ts",
  "../app/api/assets/image/candidates/generate/route.ts"
]) {
  const source = fs.readFileSync(new URL(route, import.meta.url), "utf8");
  assert.match(source, /reserveCredits\(\{/, route);
  assert.match(source, /releaseCreditReservation\(\{/, route);
  assert.match(source, /reservationKey/, route);
}

console.log("Billing reservation and settlement smoke checks passed.");
