import { getSql, hasDatabaseUrl } from "@/lib/db";

export type CreditAccount = {
  availableCredits: number;
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

let accountSchemaPromise: Promise<void> | undefined;

export async function ensureCreditAccountSchema() {
  if (!hasDatabaseUrl()) return;
  if (!accountSchemaPromise) {
    const sql = getSql();
    accountSchemaPromise = (async () => {
      await sql`
        create table if not exists credit_accounts (
          user_id uuid primary key references users(id) on delete cascade,
          available_credits bigint not null default 0 check (available_credits >= 0),
          reserved_credits bigint not null default 0 check (reserved_credits >= 0),
          lifetime_purchased bigint not null default 0,
          lifetime_consumed bigint not null default 0,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `;
      await sql`
        create table if not exists credit_purchases (
          id uuid primary key,
          user_id uuid not null references users(id) on delete cascade,
          pack_id text not null,
          credits bigint not null check (credits > 0),
          amount_usd_cents integer not null check (amount_usd_cents > 0),
          status text not null check (status in ('pending', 'paid', 'failed', 'refunded')),
          payment_provider text,
          provider_checkout_id text unique,
          provider_payment_id text,
          created_at timestamptz not null default now(),
          paid_at timestamptz,
          updated_at timestamptz not null default now()
        )
      `;
      await sql`alter table credit_purchases add column if not exists payment_provider text`;
      await sql`alter table credit_purchases add column if not exists provider_checkout_id text`;
      await sql`alter table credit_purchases add column if not exists provider_payment_id text`;
      await sql`create unique index if not exists credit_purchases_checkout_idx on credit_purchases(provider_checkout_id)`;
      await sql`create unique index if not exists credit_purchases_payment_idx on credit_purchases(provider_payment_id) where provider_payment_id is not null`;
      await sql`
        create table if not exists credit_ledger (
          id uuid primary key default uuid_generate_v4(),
          user_id uuid not null references users(id) on delete cascade,
          event_type text not null,
          credits_delta bigint not null,
          balance_after bigint not null check (balance_after >= 0),
          source_id text not null unique,
          metadata_json jsonb not null default '{}',
          created_at timestamptz not null default now()
        )
      `;
      await sql`create index if not exists credit_purchases_user_created_idx on credit_purchases(user_id, created_at desc)`;
      await sql`create index if not exists credit_ledger_user_created_idx on credit_ledger(user_id, created_at desc)`;
    })().catch((error) => {
      accountSchemaPromise = undefined;
      throw error;
    });
  }
  await accountSchemaPromise;
}

export async function getCreditAccount(userId: string): Promise<CreditAccount> {
  if (!hasDatabaseUrl()) return { availableCredits: 0, lifetimePurchased: 0, lifetimeConsumed: 0 };
  await ensureCreditAccountSchema();
  const rows = await getSql()`
    insert into credit_accounts (user_id)
    values (${userId})
    on conflict (user_id) do update set updated_at = credit_accounts.updated_at
    returning available_credits, lifetime_purchased, lifetime_consumed
  ` as Array<{ available_credits: string | number; lifetime_purchased: string | number; lifetime_consumed: string | number }>;
  return {
    availableCredits: Number(rows[0].available_credits),
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
  await ensureCreditAccountSchema();
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
  await ensureCreditAccountSchema();
  await getSql()`
    update credit_purchases
    set status = 'failed', updated_at = now()
    where id = ${purchaseId} and status = 'pending'
  `;
}

export async function expireXenditCreditPurchase(purchaseId: string, checkoutId: string) {
  await ensureCreditAccountSchema();
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
  await ensureCreditAccountSchema();
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
  await ensureCreditAccountSchema();
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
