import { BILLING_EXCHANGE_RATE_CNY_PER_USD, BILLING_RELEASE, BILLING_RETRY_RESERVE_RATE, billingCatalogItem } from "@/lib/billing/catalog";
import { estimateBilling } from "@/lib/billing/estimate";
import type { BillingResourceType } from "@/lib/billing/types";
import { getSql, hasDatabaseUrl } from "@/lib/db";
import { createHash } from "node:crypto";

type RecordUsageInput = {
  userId: string;
  projectId?: string;
  versionId?: string;
  resourceType: BillingResourceType;
  quantity: number;
  idempotencyKey: string;
  status: "settled" | "released";
  actualCostUsd?: number;
  metadata?: Record<string, unknown>;
};

export function billingIdempotencyKey(resourceType: BillingResourceType, parts: Array<string | number | undefined>) {
  const digest = createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("\u001f"))
    .digest("hex")
    .slice(0, 32);
  return `${resourceType}:${digest}`;
}

export async function recordUsageEvent(input: RecordUsageInput) {
  if (!hasDatabaseUrl()) return { recorded: false, reason: "database-not-configured" } as const;
  const estimate = estimateBilling([{ resourceType: input.resourceType, quantity: input.quantity }]);
  const line = estimate.lines[0];
  const catalog = billingCatalogItem(input.resourceType);
  const ruleKey = `${BILLING_RELEASE}:${input.resourceType}`;
  const estimatedCostMicrousd = Math.round(line.estimatedProviderCostUsd * 1_000_000);
  const actualCostMicrousd = input.actualCostUsd === undefined ? null : Math.round(input.actualCostUsd * 1_000_000);
  const settledCredits = input.status === "settled" ? line.credits : 0;
  const sql = getSql();

  try {
    const rules = await sql`
      insert into pricing_rules (
        rule_key, resource_type, provider, model, billing_unit, credits_per_unit,
        provider_rate_json, exchange_rate, retry_reserve_rate, projected_margin_rate,
        effective_from
      ) values (
        ${ruleKey}, ${input.resourceType}, ${catalog.provider}, ${catalog.model},
        ${catalog.billingUnit}, ${catalog.creditsPerUnit},
        ${JSON.stringify({ estimatedProviderUsdPerUnit: catalog.estimatedProviderUsdPerUnit, bundled: catalog.bundled ?? false })}::jsonb,
        ${BILLING_EXCHANGE_RATE_CNY_PER_USD}, ${BILLING_RETRY_RESERVE_RATE},
        ${line.projectedMarginRate}, ${new Date("2026-08-07T00:00:00.000Z")}
      )
      on conflict (rule_key) do update set
        provider_rate_json = excluded.provider_rate_json,
        exchange_rate = excluded.exchange_rate,
        retry_reserve_rate = excluded.retry_reserve_rate,
        projected_margin_rate = excluded.projected_margin_rate
      returning id
    ` as Array<{ id: string }>;
    const pricingRuleId = rules[0]?.id;
    if (!pricingRuleId) throw new Error("Pricing rule was not created.");

    await sql`
      insert into usage_events (
        user_id, project_id, version_id, resource_type, quantity, provider, model,
        pricing_rule_id, estimated_cost_microusd, actual_cost_microusd,
        reserved_credits, settled_credits, status, idempotency_key, metadata_json
      ) values (
        ${input.userId}, ${input.projectId ?? null}, ${input.versionId ?? null},
        ${input.resourceType}, ${input.quantity}, ${catalog.provider}, ${catalog.model},
        ${pricingRuleId}, ${estimatedCostMicrousd}, ${actualCostMicrousd},
        0, ${settledCredits}, ${input.status}, ${input.idempotencyKey},
        ${JSON.stringify(input.metadata ?? {})}::jsonb
      )
      on conflict (idempotency_key) do nothing
    `;
    return { recorded: true, credits: settledCredits, estimate } as const;
  } catch (error) {
    console.error("[billing] Usage event recording failed:", error);
    return { recorded: false, reason: "write-failed" } as const;
  }
}
