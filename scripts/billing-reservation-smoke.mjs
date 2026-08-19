import assert from "node:assert/strict";
import fs from "node:fs";

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const usage = fs.readFileSync(new URL("../lib/billing/usage.ts", import.meta.url), "utf8");
const accounts = fs.readFileSync(new URL("../lib/billing/accounts.ts", import.meta.url), "utf8");
const projects = fs.readFileSync(new URL("../app/api/projects/route.ts", import.meta.url), "utf8");
const background = fs.readFileSync(new URL("../lib/background-media-generation.ts", import.meta.url), "utf8");
const images = fs.readFileSync(new URL("../lib/image-assets.ts", import.meta.url), "utf8");
const audioRoute = fs.readFileSync(new URL("../app/api/assets/audio/generate/route.ts", import.meta.url), "utf8");
const videoRoute = fs.readFileSync(new URL("../app/api/assets/video/generate/route.ts", import.meta.url), "utf8");
const estimateRoute = fs.readFileSync(new URL("../app/api/billing/estimate/route.ts", import.meta.url), "utf8");

assert.match(schema, /create table if not exists credit_reservations/);
assert.match(schema, /create table if not exists provider_cost_events/);
assert.match(schema, /reservation_id uuid references credit_reservations/);
assert.match(accounts, /reservedCredits/);
assert.match(accounts, /reservation_expired/);

assert.match(usage, /export async function reserveCredits/);
assert.match(usage, /create table if not exists pricing_rules/);
assert.match(usage, /create table if not exists usage_events/);
assert.match(usage, /alter table usage_events add column if not exists reservation_id/);
assert.match(usage, /available_credits = account\.available_credits -/);
assert.match(usage, /reserved_credits = account\.reserved_credits \+/);
assert.match(usage, /lifetime_consumed = account\.lifetime_consumed \+/);
assert.match(usage, /export async function releaseCreditReservation/);
assert.match(usage, /on conflict \(idempotency_key\) do nothing/);

assert.match(projects, /projectEstimateItems/);
assert.match(projects, /reserveCredits\(\{/);
assert.match(projects, /INSUFFICIENT_CREDITS/);
assert.match(background, /reservationKey: message\.billingReservationKey/);
assert.match(background, /project_generation_completed/);
assert.match(background, /project_media_permanently_failed/);
assert.match(background, /automaticPremiumUpgrade/);

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
