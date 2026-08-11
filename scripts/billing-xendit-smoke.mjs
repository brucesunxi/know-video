import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const xenditSource = fs.readFileSync(new URL("../lib/billing/xendit.ts", import.meta.url), "utf8");
const xenditOutput = ts.transpileModule(xenditSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const xenditModule = { exports: {} };
vm.runInNewContext(xenditOutput, {
  module: xenditModule,
  exports: xenditModule.exports,
  require: (id) => id === "node:crypto" ? crypto : {},
  process,
  Buffer,
  fetch,
  AbortSignal,
  console
});

const previousWebhookToken = process.env.XENDIT_WEBHOOK_TOKEN;
process.env.XENDIT_WEBHOOK_TOKEN = "test-webhook-token";
assert.equal(xenditModule.exports.verifyXenditWebhookToken("test-webhook-token"), true);
assert.equal(xenditModule.exports.verifyXenditWebhookToken("wrong-token"), false);
assert.equal(xenditModule.exports.verifyXenditWebhookToken(null), false);
if (previousWebhookToken === undefined) delete process.env.XENDIT_WEBHOOK_TOKEN;
else process.env.XENDIT_WEBHOOK_TOKEN = previousWebhookToken;

const checkout = fs.readFileSync(new URL("../app/api/billing/checkout/route.ts", import.meta.url), "utf8");
assert.match(checkout, /requireCurrentUser/);
assert.match(checkout, /creditPack\(body\.packId/);
assert.match(checkout, /startsWith\("https:\/\/"\)/);
assert.match(checkout, /createPendingCreditPurchase/);
assert.match(checkout, /createXenditPaymentSession/);
assert.match(checkout, /attachCheckoutToCreditPurchase/);

const webhook = fs.readFileSync(new URL("../app/api/billing/webhook/xendit/route.ts", import.meta.url), "utf8");
assert.match(webhook, /x-callback-token/);
assert.match(webhook, /payment_session\.completed/);
assert.match(webhook, /data\.status !== "COMPLETED"/);
assert.match(webhook, /data\.session_type !== "PAY"/);
assert.match(webhook, /data\.currency !== "USD"/);
assert.match(webhook, /Math\.round\(data\.amount \* 100\)/);
assert.match(webhook, /status: 409/);

const accounts = fs.readFileSync(new URL("../lib/billing/accounts.ts", import.meta.url), "utf8");
assert.match(accounts, /with paid_purchase as/);
assert.match(accounts, /status = 'pending'/);
assert.match(accounts, /provider_checkout_id = \$\{input\.checkoutId\}/);
assert.match(accounts, /amount_usd_cents = \$\{input\.amountUsdCents\}/);
assert.match(accounts, /on conflict \(source_id\) do nothing/);
assert.match(accounts, /return "already_paid"/);

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
assert.match(schema, /credit_purchases_payment_idx/);
assert.match(schema, /where provider_payment_id is not null/);

console.log("Xendit billing smoke checks passed.");
