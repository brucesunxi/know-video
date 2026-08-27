import { getSql, hasDatabaseUrl } from "@/lib/db";

export type CreditAccount = {
  availableCredits: number;
  reservedCredits: number;
  lifetimePurchased: number;
  lifetimeConsumed: number;
};

export type CreditPurchaseStatus = "pending" | "paid" | "failed" | "refunded";

export type CreditPurchase = {
  id: string;
  userId: string;
  packId: string;
  credits: number;
  amountUsdCents: number;
  status: CreditPurchaseStatus;
  providerCheckoutId?: string;
  providerPaymentId?: string;
};

export async function getCreditAccount(userId: string): Promise<CreditAccount> {
  if (!hasDatabaseUrl()) return { availableCredits: 0, reservedCredits: 0, lifetimePurchased: 0, lifetimeConsumed: 0 };
  const sql = getSql();
  await sql`
    insert into credit_accounts (user_id)
    values (${userId})
    on conflict (user_id) do update set updated_at = credit_accounts.updated_at
  `;
  await sql`
    with expired as (
      update credit_reservations reservation
      set released_credits = reservation.reserved_credits - reservation.settled_credits,
        status = case when reservation.settled_credits > 0 then 'settled' else 'released' end,
        metadata_json = reservation.metadata_json || jsonb_build_object('releaseReason', 'reservation_expired'),
        updated_at = now()
      where reservation.user_id = ${userId}
        and reservation.status in ('reserved', 'partially_settled')
        and reservation.expires_at <= now()
      returning reservation.user_id, reservation.reservation_key, reservation.released_credits
    ), credited as (
      update credit_accounts account
      set available_credits = account.available_credits + totals.released_credits,
        reserved_credits = account.reserved_credits - totals.released_credits,
        updated_at = now()
      from (
        select user_id, sum(released_credits)::bigint as released_credits
        from expired group by user_id
      ) totals
      where account.user_id = totals.user_id
      returning account.available_credits
    )
    insert into credit_ledger (user_id, event_type, credits_delta, balance_after, source_id, metadata_json)
    select expired.user_id, 'release', expired.released_credits,
      (select available_credits from credited), 'release:' || expired.reservation_key,
      jsonb_build_object('reason', 'reservation_expired')
    from expired
    on conflict (source_id) do nothing
  `;
  const rows = await sql`
    select available_credits, reserved_credits, lifetime_purchased, lifetime_consumed
    from credit_accounts
    where user_id = ${userId}
  ` as Array<{ available_credits: string | number; reserved_credits: string | number; lifetime_purchased: string | number; lifetime_consumed: string | number }>;
  return {
    availableCredits: Number(rows[0].available_credits),
    reservedCredits: Number(rows[0].reserved_credits),
    lifetimePurchased: Number(rows[0].lifetime_purchased),
    lifetimeConsumed: Number(rows[0].lifetime_consumed)
  };
}

function toPurchase(row: {
  id: string;
  user_id: string;
  pack_id: string;
  credits: string | number;
  amount_usd_cents: number;
  status: CreditPurchaseStatus;
  provider_checkout_id: string | null;
  provider_payment_id: string | null;
}): CreditPurchase {
  return {
    id: row.id,
    userId: row.user_id,
    packId: row.pack_id,
    credits: Number(row.credits),
    amountUsdCents: row.amount_usd_cents,
    status: row.status,
    providerCheckoutId: row.provider_checkout_id ?? undefined,
    providerPaymentId: row.provider_payment_id ?? undefined
  };
}

export async function createPendingCreditPurchase(input: {
  id: string;
  userId: string;
  packId: string;
  credits: number;
  amountUsdCents: number;
}) {
  await getCreditAccount(input.userId);
  await getSql()`
    insert into credit_purchases (
      id, user_id, pack_id, credits, amount_usd_cents, status, payment_provider
    ) values (
      ${input.id}, ${input.userId}, ${input.packId}, ${input.credits},
      ${input.amountUsdCents}, 'pending', 'xendit'
    )
  `;
}

export async function attachCheckoutToCreditPurchase(purchaseId: string, checkoutId: string) {
  await getSql()`
    update credit_purchases
    set provider_checkout_id = ${checkoutId}, updated_at = now()
    where id = ${purchaseId} and status = 'pending' and payment_provider = 'xendit'
  `;
}

export async function failCreditPurchase(purchaseId: string) {
  await getSql()`
    update credit_purchases
    set status = 'failed', updated_at = now()
    where id = ${purchaseId} and status = 'pending'
  `;
}

export async function expireXenditCreditPurchase(purchaseId: string, checkoutId: string) {
  await getSql()`
    update credit_purchases
    set status = 'failed', updated_at = now()
    where id = ${purchaseId}
      and status = 'pending'
      and payment_provider = 'xendit'
      and provider_checkout_id = ${checkoutId}
  `;
}

export async function getCreditPurchaseForUser(purchaseId: string, userId: string) {
  const rows = await getSql()`
    select id, user_id, pack_id, credits, amount_usd_cents, status,
      provider_checkout_id, provider_payment_id
    from credit_purchases
    where id = ${purchaseId} and user_id = ${userId}
    limit 1
  ` as Parameters<typeof toPurchase>[0][];
  return rows[0] ? toPurchase(rows[0]) : undefined;
}

export async function settleXenditCreditPurchase(input: {
  purchaseId: string;
  checkoutId: string;
  paymentId: string;
  amountUsdCents: number;
}) {
  const rows = await getSql()`
    with paid_purchase as (
      update credit_purchases
      set status = 'paid', provider_payment_id = ${input.paymentId}, paid_at = now(), updated_at = now()
      where id = ${input.purchaseId}
        and status = 'pending'
        and payment_provider = 'xendit'
        and provider_checkout_id = ${input.checkoutId}
        and amount_usd_cents = ${input.amountUsdCents}
      returning id, user_id, credits, pack_id, amount_usd_cents
    ), credited_account as (
      update credit_accounts account
      set available_credits = account.available_credits + purchase.credits,
        lifetime_purchased = account.lifetime_purchased + purchase.credits,
        updated_at = now()
      from paid_purchase purchase
      where account.user_id = purchase.user_id
      returning account.user_id, account.available_credits, purchase.id,
        purchase.credits, purchase.pack_id, purchase.amount_usd_cents
    ), ledger_entry as (
      insert into credit_ledger (
        user_id, event_type, credits_delta, balance_after, source_id, metadata_json
      )
      select user_id, 'purchase', credits, available_credits,
        'xendit:' || id::text,
        jsonb_build_object(
          'provider', 'xendit', 'packId', pack_id, 'amountUsdCents', amount_usd_cents,
          'checkoutId', ${input.checkoutId}, 'paymentId', ${input.paymentId}
        )
      from credited_account
      on conflict (source_id) do nothing
      returning source_id
    )
    select
      exists(select 1 from ledger_entry) as credited,
      (select status from credit_purchases where id = ${input.purchaseId}) as purchase_status
  ` as Array<{ credited: boolean; purchase_status: CreditPurchaseStatus | null }>;
  if (rows[0]?.credited === true) return "credited" as const;
  if (rows[0]?.purchase_status === "paid") return "already_paid" as const;
  return "mismatch" as const;
}
