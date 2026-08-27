import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const healthSource = fs.readFileSync(new URL("../lib/generation-health.ts", import.meta.url), "utf8");
const healthOutput = ts.transpileModule(healthSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const healthModule = { exports: {} };
vm.runInNewContext(healthOutput, {
  module: healthModule,
  exports: healthModule.exports,
  require: () => ({ hasDatabaseUrl: () => false, getSql: () => undefined })
});
const emptyAudit = await healthModule.exports.readGenerationHealthAudit();
assert.equal(Array.isArray(emptyAudit.pendingGenerations), true);
assert.equal(emptyAudit.pendingGenerations.length, 0);
assert.equal(emptyAudit.creditInvariantViolations.length, 0);
assert.match(emptyAudit.generatedAt, /^\d{4}-\d{2}-\d{2}T/);

assert.match(healthSource, /request\.status = 'pending'/);
assert.match(healthSource, /job\.status in \('queued', 'running'\)/);
assert.match(healthSource, /reservation\.status in \('reserved', 'partially_settled'\)/);
assert.match(healthSource, /account\.reserved_credits <> coalesce\(total\.open_credits, 0\)/);
assert.match(healthSource, /request\.status = 'ready'/);
assert.match(healthSource, /and media\.initial_version/);
assert.doesNotMatch(healthSource, /\b(?:update|delete|insert|alter|drop)\s+(?:generation_requests|render_jobs|credit_reservations|credit_accounts|projects|project_versions|scenes|scene_assets)\b/iu);

const route = fs.readFileSync(new URL("../app/api/admin/generation-health/route.ts", import.meta.url), "utf8");
const adminClient = fs.readFileSync(new URL("../app/admin/admin-credits-client.tsx", import.meta.url), "utf8");
assert.match(route, /await requireAdminUser\(\)/);
assert.match(route, /readGenerationHealthAudit\(\)/);
assert.match(route, /ADMIN_FORBIDDEN/);
assert.match(adminClient, /\/api\/admin\/generation-health/);
assert.match(adminClient, /creditInvariantViolations/);
assert.match(adminClient, /readyRequestsWithIncompleteMedia/);

console.log("Generation health audit smoke checks passed.");
