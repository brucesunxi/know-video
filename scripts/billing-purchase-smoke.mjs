import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function loadTypeScript(path, dependencies = {}) {
  const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: (id) => dependencies[id] ?? {},
    Buffer,
    URLSearchParams,
    console
  });
  return module.exports;
}

const videoPolicy = loadTypeScript("../lib/video-cost-policy.ts");
const catalog = loadTypeScript("../lib/billing/catalog.ts", {
  "@/lib/video-cost-policy": videoPolicy
});
const packs = loadTypeScript("../lib/billing/packs.ts");

assert.deepEqual(Array.from(packs.creditPacks, (pack) => [pack.id, pack.priceUsdCents, pack.credits]), [
  ["starter", 900, 1_000],
  ["creator", 2_900, 3_500],
  ["studio", 7_900, 10_500]
]);
assert.equal(packs.creditPack("creator").featured, true);
assert.equal(packs.creditPack("invalid"), undefined);

for (const pack of packs.creditPacks) {
  const creditsPerDollar = pack.credits / (pack.priceUsdCents / 100);
  for (const item of Object.values(catalog.billingCatalog)) {
    if (item.bundled || item.creditsPerUnit === 0) continue;
    const revenueUsd = item.creditsPerUnit / creditsPerDollar;
    const netRevenueUsd = revenueUsd * 0.97;
    const loadedCostUsd = item.estimatedProviderUsdPerUnit * 1.10;
    const margin = (netRevenueUsd - loadedCostUsd) / netRevenueUsd;
    assert.ok(margin >= 0.40, `${pack.id}/${item.resourceType} margin ${margin}`);
  }
}

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
assert.match(schema, /create table if not exists credit_accounts/);
assert.match(schema, /create table if not exists credit_purchases/);
assert.match(schema, /create table if not exists credit_ledger/);
assert.match(schema, /payment_provider text/);
assert.match(schema, /provider_checkout_id text unique/);
assert.match(schema, /source_id text not null unique/);

const accounts = fs.readFileSync(new URL("../lib/billing/accounts.ts", import.meta.url), "utf8");
const accountRoute = fs.readFileSync(new URL("../app/api/billing/account/route.ts", import.meta.url), "utf8");
const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
assert.match(accountRoute, /requireCurrentUser/);
assert.match(accountRoute, /xenditIsConfigured/);
assert.match(accountRoute, /paymentProvider: "xendit"/);
assert.match(accounts, /create table if not exists credit_accounts/);
assert.match(workspace, /购买 Credits/);
assert.match(workspace, /One-time payment in USD/);
assert.match(workspace, /\/api\/billing\/checkout/);
assert.match(workspace, /Xendit 尚未配置完成/);
assert.doesNotMatch(workspace, /Stripe/);
assert.doesNotMatch(workspace, /点数 = ¥1/);

console.log("Billing purchase smoke checks passed.");
