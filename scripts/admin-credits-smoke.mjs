import assert from "node:assert/strict";
import fs from "node:fs";

function read(path) {
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
}

const admin = read("../lib/admin.ts");
assert.match(admin, /ADMIN_EMAIL = "sunxi0302@gmail\.com"/);
assert.match(admin, /requireCurrentUser/);
assert.match(admin, /ADMIN_FORBIDDEN/);

const route = read("../app/api/admin/credits/route.ts");
assert.match(route, /requireAdminUser/);
assert.match(route, /credits: z\.number\(\)\.int\(\)\.min\(1\)\.max\(1_000_000\)/);
assert.match(route, /requestId: z\.string\(\)\.uuid\(\)/);
assert.match(route, /grantAdminCredits/);

const ledger = read("../lib/billing/admin-credits.ts");
assert.match(ledger, /pg_advisory_xact_lock/);
assert.match(ledger, /event_type, credits_delta, balance_after, source_id, metadata_json/);
assert.match(ledger, /'admin_grant'/);
assert.match(ledger, /available_credits = account\.available_credits \+ \$\{input\.credits\}/);
assert.match(ledger, /on conflict \(source_id\) do nothing/);
assert.match(ledger, /adminEmail: input\.adminEmail/);

const page = read("../app/admin/page.tsx");
assert.match(page, /isAdminUser/);
assert.match(page, /notFound\(\)/);

const workspace = read("../app/workspace-client.tsx");
assert.match(workspace, /currentUser\.email\.trim\(\)\.toLowerCase\(\) === "sunxi0302@gmail\.com"/);
assert.match(workspace, /href="\/admin"/);

console.log("Admin credits smoke checks passed.");
