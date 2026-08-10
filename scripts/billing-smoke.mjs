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
    console
  });
  return module.exports;
}

const videoPolicy = loadTypeScript("../lib/video-cost-policy.ts");
const catalog = loadTypeScript("../lib/billing/catalog.ts", {
  "@/lib/video-cost-policy": videoPolicy
});
const estimateModule = loadTypeScript("../lib/billing/estimate.ts", {
  "@/lib/billing/catalog": catalog
});
const { estimateBilling } = estimateModule;

const economy = estimateBilling([{ resourceType: "video_economy_3s", quantity: 1 }]);
assert.equal(economy.maximumCredits, 300);
assert.equal(economy.estimatedProviderCostUsd, 0.16);
assert.ok(economy.projectedMarginRate >= 0.40);

const balanced = estimateBilling([{ resourceType: "video_balanced_3s", quantity: 1 }]);
assert.equal(balanced.maximumCredits, 430);
assert.equal(balanced.estimatedProviderCostUsd, 0.23);
assert.ok(balanced.projectedMarginRate >= 0.40);

assert.equal(estimateBilling([{ resourceType: "speech", quantity: 1 }]).maximumCredits, 5);
assert.equal(estimateBilling([{ resourceType: "speech", quantity: 30 }]).maximumCredits, 30);

const staticVideo = estimateBilling([
  { resourceType: "storyboard_plan", quantity: 1 },
  { resourceType: "image_standard", quantity: 5 },
  { resourceType: "speech", quantity: 30 }
]);
assert.equal(staticVideo.maximumCredits, 150);
assert.ok(staticVideo.projectedMarginRate >= 0.40);

for (const item of Object.values(catalog.billingCatalog)) {
  const estimate = estimateBilling([{ resourceType: item.resourceType, quantity: 1 }]);
  if (!item.bundled) assert.ok(estimate.lines[0].projectedMarginRate >= 0.40, item.resourceType);
}

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
assert.match(schema, /create table if not exists pricing_rules/);
assert.match(schema, /create table if not exists usage_events/);
assert.match(schema, /idempotency_key text not null unique/);

const estimateRoute = fs.readFileSync(new URL("../app/api/billing/estimate/route.ts", import.meta.url), "utf8");
assert.match(estimateRoute, /requireCurrentUser/);
assert.match(estimateRoute, /estimateBilling/);

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
assert.doesNotMatch(workspace, /996/);
assert.match(workspace, /按量计费 · 查看价格/);
assert.match(workspace, /账户充值与余额扣减上线后/);

for (const route of [
  "../app/api/projects/route.ts",
  "../app/api/edit-plan/route.ts",
  "../app/api/assets/generate/route.ts",
  "../app/api/assets/audio/generate/route.ts",
  "../app/api/assets/video/generate/route.ts",
  "../app/api/assets/image/candidates/generate/route.ts"
]) {
  const source = fs.readFileSync(new URL(route, import.meta.url), "utf8");
  assert.match(source, /recordUsageEvent/, route);
}

console.log("Billing phase-one smoke checks passed.");
