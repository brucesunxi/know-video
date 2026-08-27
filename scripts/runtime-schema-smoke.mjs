import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const runtimeRoots = ["app", "lib"];
const runtimeExtensions = new Set([".js", ".mjs", ".ts", ".tsx"]);
const runtimeDdl = /\b(?:create\s+table|alter\s+table|create\s+(?:unique\s+)?index|information_schema)\b/i;

function runtimeFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return runtimeFiles(fullPath);
    return runtimeExtensions.has(path.extname(entry.name)) ? [fullPath] : [];
  });
}

for (const directory of runtimeRoots) {
  for (const file of runtimeFiles(path.join(root, directory))) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, runtimeDdl, `${path.relative(root, file)} must not migrate or inspect schemas at runtime`);
  }
}

const schema = fs.readFileSync(path.join(root, "db/schema.sql"), "utf8");
for (const required of [
  /create table if not exists generation_requests/,
  /generation_requests \([\s\S]*options_json jsonb/,
  /create index if not exists generation_requests_user_status_updated_idx/,
  /create table if not exists render_jobs[\s\S]*metadata_json jsonb not null default '\{\}'/,
  /create table if not exists pricing_rules/,
  /create table if not exists usage_events/,
  /alter table usage_events[\s\S]*reservation_id uuid references credit_reservations/,
  /create table if not exists credit_accounts/,
  /create table if not exists credit_reservations/,
  /create table if not exists credit_purchases/,
  /create table if not exists credit_ledger/,
  /create table if not exists provider_cost_events/
]) {
  assert.match(schema, required);
}

const init = fs.readFileSync(path.join(root, "scripts/init-db.mjs"), "utf8");
assert.match(init, /db\/schema\.sql/);
assert.match(init, /Database schema applied/);

console.log("Runtime schema isolation smoke checks passed.");
