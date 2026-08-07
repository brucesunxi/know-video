import {
  BILLING_EXCHANGE_RATE_CNY_PER_USD,
  BILLING_PAYMENT_FEE_RATE,
  BILLING_MINIMUM_MARGIN_RATE,
  BILLING_RETRY_RESERVE_RATE,
  BILLING_TAX_RATE,
  POINTS_PER_CNY,
  billingCatalogItem
} from "@/lib/billing/catalog";
import type { BillingEstimate, BillingEstimateItemInput, BillingEstimateLine } from "@/lib/billing/types";

function roundedCost(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function lineMargin(credits: number, providerCostUsd: number) {
  if (credits <= 0) return null;
  const grossRevenueCny = credits / POINTS_PER_CNY;
  const netRevenueCny = grossRevenueCny / (1 + BILLING_TAX_RATE);
  const paymentFeeCny = grossRevenueCny * BILLING_PAYMENT_FEE_RATE;
  const loadedCostCny = providerCostUsd
    * BILLING_EXCHANGE_RATE_CNY_PER_USD
    * (1 + BILLING_RETRY_RESERVE_RATE);
  return (netRevenueCny - paymentFeeCny - loadedCostCny) / netRevenueCny;
}

export function estimateBilling(items: BillingEstimateItemInput[]): BillingEstimate {
  const lines: BillingEstimateLine[] = items.map((input) => {
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      throw new Error(`Invalid billing quantity for ${input.resourceType}.`);
    }
    const catalog = billingCatalogItem(input.resourceType);
    const rawCredits = Math.ceil(catalog.creditsPerUnit * input.quantity);
    const credits = Math.max(catalog.minimumCredits ?? 0, rawCredits);
    const estimatedProviderCostUsd = roundedCost(catalog.estimatedProviderUsdPerUnit * input.quantity);
    const projectedMarginRate = lineMargin(credits, estimatedProviderCostUsd);
    if (!catalog.bundled && projectedMarginRate !== null && projectedMarginRate < BILLING_MINIMUM_MARGIN_RATE) {
      throw new Error(`Billing margin floor violated for ${input.resourceType}.`);
    }
    return {
      ...input,
      label: catalog.label,
      provider: catalog.provider,
      model: catalog.model,
      billingUnit: catalog.billingUnit,
      credits,
      estimatedProviderCostUsd,
      projectedMarginRate
    };
  });
  const maximumCredits = lines.reduce((sum, line) => sum + line.credits, 0);
  const estimatedProviderCostUsd = roundedCost(lines.reduce((sum, line) => sum + line.estimatedProviderCostUsd, 0));
  return {
    maximumCredits,
    estimatedProviderCostUsd,
    projectedMarginRate: lineMargin(maximumCredits, estimatedProviderCostUsd),
    currency: "CNY",
    pointsPerCny: POINTS_PER_CNY,
    lines
  };
}
