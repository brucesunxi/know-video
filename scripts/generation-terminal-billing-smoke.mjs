import assert from "node:assert/strict";
import fs from "node:fs";

const requests = fs.readFileSync(new URL("../lib/generation-requests.ts", import.meta.url), "utf8");
const usage = fs.readFileSync(new URL("../lib/billing/usage.ts", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../lib/background-media-generation.ts", import.meta.url), "utf8");
const projects = fs.readFileSync(new URL("../app/api/projects/route.ts", import.meta.url), "utf8");
const reconciliation = fs.readFileSync(new URL("../lib/generation-reconciliation.ts", import.meta.url), "utf8");

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing section start: ${start}`);
  assert.notEqual(endIndex, -1, `Missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

const complete = section(
  requests,
  "export async function completeGenerationRequest",
  "export async function attachGenerationRequestProject"
);
const fail = requests.slice(requests.indexOf("export async function failGenerationRequest"));
const deleteFailed = section(
  requests,
  "export async function deleteFailedGenerationRequest",
  "export async function completeGenerationRequest"
);

for (const terminal of [complete, fail]) {
  assert.match(terminal, /sql\.transaction\(\[/);
  assert.match(terminal, /pg_advisory_xact_lock/);
  assert.match(terminal, /and user_id = \$\{input\.userId\}/);
}

assert.ok(complete.indexOf("set status = 'ready'") < complete.indexOf("buildCreditReservationReleaseQuery"));
assert.match(complete, /status: "ready"/);
assert.match(complete, /projectId: input\.projectId/);
assert.ok(fail.indexOf("set status = 'failed'") < fail.indexOf("buildCreditReservationRefundQuery"));
assert.match(fail, /status: "failed"/);
assert.ok(deleteFailed.indexOf("buildCreditReservationRefundQuery") < deleteFailed.indexOf("delete from generation_requests"));

assert.match(usage, /where generation\.id::text = \$\{generationRequestId\}/);
assert.match(usage, /and generation\.user_id = \$\{input\.userId\}/);
assert.match(usage, /and generation\.status = \$\{generationStatus\}/);
assert.match(usage, /generationProjectId/);

for (const [name, source] of [
  ["background worker", worker],
  ["project creation route", projects],
  ["generation reconciliation", reconciliation]
]) {
  assert.doesNotMatch(source, /refundCreditReservation|releaseCreditReservation/, name);
}

assert.match(worker, /releaseReason: "project_generation_completed"/);
assert.match(worker, /refundReason: "project_media_permanently_failed"/);
assert.match(worker, /project_generation_watchdog_terminal_repair/);
assert.match(projects, /refundReason: "project_generation_failed"/);
assert.match(reconciliation, /releaseReason: "project_generation_reconciled"/);
assert.match(requests, /terminal_generation_billing_repair/);
assert.match(requests, /billing_repair_needed/);

const watchdogIndex = projects.indexOf("await enqueueProjectGenerationWatchdog({");
const reservationIndex = projects.indexOf("const reservation = await reserveCredits({");
assert.ok(watchdogIndex >= 0 && reservationIndex >= 0 && watchdogIndex < reservationIndex);

console.log("Generation terminal state and billing transaction smoke checks passed.");
