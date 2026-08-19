import { createHash } from "node:crypto";
import {
  BILLING_EXCHANGE_RATE_CNY_PER_USD,
  BILLING_RELEASE,
  BILLING_RETRY_RESERVE_RATE,
  billingCatalogItem
} from "@/lib/billing/catalog";
import { ensureCreditAccountSchema, getCreditAccount } from "@/lib/billing/accounts";
import { estimateBilling } from "@/lib/billing/estimate";
import type { BillingEstimateItemInput, BillingResourceType } from "@/lib/billing/types";
import { getSql, hasDatabaseUrl } from "@/lib/db";

type ReservationInput = {
  userId: string;
  reservationKey: string;
  items: BillingEstimateItemInput[];
  metadata?: Record<string, unknown>;
  expiresInMinutes?: number;
};

type RecordUsageInput = {
  userId: string;
  projectId?: string;
  versionId?: string;
  reservationKey?: string;
  resourceType: BillingResourceType;
  quantity: number;
  idempotencyKey: string;
  status: "settled" | "released";
  actualCostUsd?: number;
  actualProvider?: string;
  actualModel?: string;
  metadata?: Record<string, unknown>;
};

export class InsufficientCreditsError extends Error {
  readonly availableCredits: number;
  readonly requiredCredits: number;

  constructor(availableCredits: number, requiredCredits: number) {
    super(`Credits 不足：需要 ${requiredCredits}，当前可用 ${availableCredits}。`);
    this.name = "InsufficientCreditsError";
    this.availableCredits = availableCredits;
    this.requiredCredits = requiredCredits;
  }
}

export function billingIdempotencyKey(resourceType: BillingResourceType, parts: Array<string | number | undefined>) {
  const digest = createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("\u001f"))
    .digest("hex")
    .slice(0, 32);
  return `${resourceType}:${digest}`;
}

function asMicrousd(value: number) {
  return Math.max(0, Math.round(value * 1_000_000));
}

async function ensureUsageSchema() {
  await ensureCreditAccountSchema();
  await getSql()`alter table usage_events add column if not exists reservation_id uuid references credit_reservations(id) on delete set null`;
}

export async function reserveCredits(input: ReservationInput) {
  const estimate = estimateBilling(input.items);
  if (!hasDatabaseUrl()) return { reserved: false, reason: "database-not-configured", estimate } as const;
  await ensureUsageSchema();
  await getCreditAccount(input.userId);
  const sql = getSql();
  const expiresInMinutes = Math.max(5, Math.min(24 * 60, input.expiresInMinutes ?? 120));
  const rows = await sql`
    with reservation_lock as (
      select pg_advisory_xact_lock(hashtext(${input.reservationKey}))
    ), existing as (
      select reservation.*
      from credit_reservations reservation, reservation_lock
      where reservation.reservation_key = ${input.reservationKey}
    ), debited as (
      update credit_accounts account
      set available_credits = account.available_credits - ${estimate.maximumCredits},
        reserved_credits = account.reserved_credits + ${estimate.maximumCredits},
        updated_at = now()
      where account.user_id = ${input.userId}
        and account.available_credits >= ${estimate.maximumCredits}
        and not exists (select 1 from existing)
      returning account.available_credits
    ), inserted as (
      insert into credit_reservations (
        user_id, reservation_key, reserved_credits, estimated_cost_microusd,
        estimate_json, metadata_json, expires_at
      )
      select ${input.userId}, ${input.reservationKey}, ${estimate.maximumCredits},
        ${asMicrousd(estimate.estimatedProviderCostUsd)}, ${JSON.stringify(estimate)}::jsonb,
        ${JSON.stringify(input.metadata ?? {})}::jsonb,
        now() + (${expiresInMinutes}::text || ' minutes')::interval
      from debited
      returning *, (select available_credits from debited) as available_credits
    ), ledger_entry as (
      insert into credit_ledger (
        user_id, event_type, credits_delta, balance_after, source_id, metadata_json
      )
      select user_id, 'reserve', -reserved_credits, available_credits,
        'reserve:' || reservation_key,
        jsonb_build_object('reservationKey', reservation_key, 'estimate', estimate_json)
      from inserted
      on conflict (source_id) do nothing
    )
    select id, user_id, reservation_key, status, reserved_credits,
      settled_credits, released_credits
    from existing
    union all
    select id, user_id, reservation_key, status, reserved_credits,
      settled_credits, released_credits
    from inserted
    limit 1
  ` as Array<{
    id: string;
    user_id: string;
    reservation_key: string;
    status: string;
    reserved_credits: string | number;
    settled_credits: string | number;
    released_credits: string | number;
  }>;
  const reservation = rows[0];
  if (!reservation) {
    const account = await getCreditAccount(input.userId);
    throw new InsufficientCreditsError(account.availableCredits, estimate.maximumCredits);
  }
  if (reservation.user_id !== input.userId) throw new Error("Billing reservation ownership mismatch.");
  return {
    reserved: true,
    reservationKey: reservation.reservation_key,
    status: reservation.status,
    reservedCredits: Number(reservation.reserved_credits),
    remainingCredits: Number(reservation.reserved_credits) - Number(reservation.settled_credits) - Number(reservation.released_credits),
    estimate
  } as const;
}

export async function reserveAdditionalCredits(input: {
  userId: string;
  reservationKey: string;
  adjustmentKey: string;
  credits: number;
  estimatedCostUsd?: number;
  metadata?: Record<string, unknown>;
}) {
  if (!hasDatabaseUrl() || input.credits <= 0) return { reserved: false } as const;
  await ensureUsageSchema();
  const sql = getSql();
  const sourceId = `reserve-adjustment:${input.adjustmentKey}`;
  const rows = await sql`
    with reservation_lock as (
      select pg_advisory_xact_lock(hashtext(${input.reservationKey}))
    ), target as (
      select reservation.*
      from credit_reservations reservation, reservation_lock
      where reservation.reservation_key = ${input.reservationKey}
        and reservation.user_id = ${input.userId}
        and reservation.status in ('reserved', 'partially_settled')
        and not exists (select 1 from credit_ledger where source_id = ${sourceId})
    ), debited as (
      update credit_accounts account
      set available_credits = account.available_credits - ${input.credits},
        reserved_credits = account.reserved_credits + ${input.credits},
        updated_at = now()
      from target
      where account.user_id = target.user_id
        and account.available_credits >= ${input.credits}
      returning account.available_credits, target.id
    ), updated as (
      update credit_reservations reservation
      set reserved_credits = reservation.reserved_credits + ${input.credits},
        estimated_cost_microusd = reservation.estimated_cost_microusd + ${asMicrousd(input.estimatedCostUsd ?? 0)},
        metadata_json = reservation.metadata_json || ${JSON.stringify(input.metadata ?? {})}::jsonb,
        updated_at = now()
      from debited
      where reservation.id = debited.id
      returning reservation.*, debited.available_credits
    ), ledger_entry as (
      insert into credit_ledger (user_id, event_type, credits_delta, balance_after, source_id, metadata_json)
      select user_id, 'reserve_adjustment', -${input.credits}, available_credits, ${sourceId},
        ${JSON.stringify({ reservationKey: input.reservationKey, ...input.metadata })}::jsonb
      from updated
      on conflict (source_id) do nothing
      returning source_id
    )
    select reserved_credits from updated
  ` as Array<{ reserved_credits: string | number }>;
  if (rows[0]) return { reserved: true, reservedCredits: Number(rows[0].reserved_credits) } as const;
  const existing = await sql`select 1 from credit_ledger where source_id = ${sourceId} limit 1`;
  if (existing.length > 0) return { reserved: true, duplicate: true } as const;
  const account = await getCreditAccount(input.userId);
  throw new InsufficientCreditsError(account.availableCredits, input.credits);
}

export async function releaseCreditReservation(input: {
  userId: string;
  reservationKey: string;
  reason: string;
  metadata?: Record<string, unknown>;
}) {
  if (!hasDatabaseUrl()) return { released: false } as const;
  await ensureUsageSchema();
  const rows = await getSql()`
    with reservation_lock as (
      select pg_advisory_xact_lock(hashtext(${input.reservationKey}))
    ), released as (
      update credit_reservations reservation
      set released_credits = reservation.reserved_credits - reservation.settled_credits,
        status = case when reservation.settled_credits > 0 then 'settled' else 'released' end,
        metadata_json = reservation.metadata_json || ${JSON.stringify({ releaseReason: input.reason, ...input.metadata })}::jsonb,
        updated_at = now()
      from reservation_lock
      where reservation.reservation_key = ${input.reservationKey}
        and reservation.user_id = ${input.userId}
        and reservation.status in ('reserved', 'partially_settled')
      returning reservation.user_id, reservation.released_credits, reservation.reservation_key
    ), credited as (
      update credit_accounts account
      set available_credits = account.available_credits + released.released_credits,
        reserved_credits = account.reserved_credits - released.released_credits,
        updated_at = now()
      from released
      where account.user_id = released.user_id
      returning account.available_credits, released.*
    ), ledger_entry as (
      insert into credit_ledger (user_id, event_type, credits_delta, balance_after, source_id, metadata_json)
      select user_id, 'release', released_credits, available_credits,
        'release:' || reservation_key,
        ${JSON.stringify({ reason: input.reason, ...input.metadata })}::jsonb
      from credited
      on conflict (source_id) do nothing
    )
    select released_credits from credited
  ` as Array<{ released_credits: string | number }>;
  return { released: Boolean(rows[0]), credits: Number(rows[0]?.released_credits ?? 0) } as const;
}

async function pricingRuleId(resourceType: BillingResourceType) {
  const line = estimateBilling([{ resourceType, quantity: 1 }]).lines[0];
  const catalog = billingCatalogItem(resourceType);
  const rows = await getSql()`
    insert into pricing_rules (
      rule_key, resource_type, provider, model, billing_unit, credits_per_unit,
      provider_rate_json, exchange_rate, retry_reserve_rate, projected_margin_rate,
      effective_from
    ) values (
      ${`${BILLING_RELEASE}:${resourceType}`}, ${resourceType}, ${catalog.provider}, ${catalog.model},
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
  if (!rows[0]?.id) throw new Error("Pricing rule was not created.");
  return rows[0].id;
}

export async function recordUsageEvent(input: RecordUsageInput) {
  const estimate = estimateBilling([{ resourceType: input.resourceType, quantity: input.quantity }]);
  const line = estimate.lines[0];
  if (!hasDatabaseUrl()) return { recorded: false, reason: "database-not-configured", estimate } as const;
  await ensureUsageSchema();
  const reservationKey = input.reservationKey ?? `usage:${input.idempotencyKey}`;
  await reserveCredits({
    userId: input.userId,
    reservationKey,
    items: [{ resourceType: input.resourceType, quantity: input.quantity }],
    metadata: { implicit: !input.reservationKey, resourceType: input.resourceType }
  });
  if (input.status === "released") {
    await releaseCreditReservation({ userId: input.userId, reservationKey, reason: "usage_released", metadata: input.metadata });
    return { recorded: true, credits: 0, estimate } as const;
  }

  const catalog = billingCatalogItem(input.resourceType);
  const ruleId = await pricingRuleId(input.resourceType);
  const sql = getSql();
  const rows = await sql`
    with reservation_lock as (
      select pg_advisory_xact_lock(hashtext(${reservationKey}))
    ), target as (
      select reservation.*
      from credit_reservations reservation, reservation_lock
      where reservation.reservation_key = ${reservationKey}
        and reservation.user_id = ${input.userId}
        and reservation.status in ('reserved', 'partially_settled')
        and reservation.reserved_credits - reservation.settled_credits - reservation.released_credits >= ${line.credits}
    ), inserted_event as (
      insert into usage_events (
        user_id, project_id, version_id, resource_type, quantity, provider, model,
        pricing_rule_id, estimated_cost_microusd, actual_cost_microusd,
        reserved_credits, settled_credits, status, idempotency_key, metadata_json,
        reservation_id
      )
      select ${input.userId}, ${input.projectId ?? null}, ${input.versionId ?? null},
        ${input.resourceType}, ${input.quantity}, ${input.actualProvider ?? catalog.provider},
        ${input.actualModel ?? catalog.model}, ${ruleId}, ${asMicrousd(line.estimatedProviderCostUsd)},
        ${input.actualCostUsd === undefined ? null : asMicrousd(input.actualCostUsd)},
        ${line.credits}, ${line.credits}, 'settled', ${input.idempotencyKey},
        ${JSON.stringify(input.metadata ?? {})}::jsonb, target.id
      from target
      on conflict (idempotency_key) do nothing
      returning reservation_id, settled_credits
    ), updated_reservation as (
      update credit_reservations reservation
      set settled_credits = reservation.settled_credits + event.settled_credits,
        status = case
          when reservation.settled_credits + event.settled_credits + reservation.released_credits = reservation.reserved_credits then 'settled'
          else 'partially_settled'
        end,
        updated_at = now()
      from inserted_event event
      where reservation.id = event.reservation_id
      returning reservation.user_id, reservation.reservation_key, event.settled_credits
    ), consumed as (
      update credit_accounts account
      set reserved_credits = account.reserved_credits - reservation.settled_credits,
        lifetime_consumed = account.lifetime_consumed + reservation.settled_credits,
        updated_at = now()
      from updated_reservation reservation
      where account.user_id = reservation.user_id
      returning account.available_credits, reservation.*
    ), ledger_entry as (
      insert into credit_ledger (user_id, event_type, credits_delta, balance_after, source_id, metadata_json)
      select user_id, 'settle', 0, available_credits, 'settle:' || ${input.idempotencyKey},
        jsonb_build_object('reservationKey', reservation_key, 'settledCredits', settled_credits)
      from consumed
      on conflict (source_id) do nothing
    )
    select settled_credits from consumed
  ` as Array<{ settled_credits: string | number }>;
  if (!rows[0]) {
    const existing = await sql`select settled_credits from usage_events where idempotency_key = ${input.idempotencyKey} limit 1` as Array<{ settled_credits: string | number }>;
    if (existing[0]) return { recorded: true, duplicate: true, credits: Number(existing[0].settled_credits), estimate } as const;
    throw new Error(`Billing reservation ${reservationKey} does not have enough reserved credits.`);
  }
  return { recorded: true, credits: Number(rows[0].settled_credits), estimate } as const;
}
