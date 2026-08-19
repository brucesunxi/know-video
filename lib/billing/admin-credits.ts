import { ensureCreditAccountSchema } from "@/lib/billing/accounts";
import { getSql } from "@/lib/db";

export type AdminCreditTarget = {
  id: string;
  email: string;
  name?: string;
  availableCredits: number;
  reservedCredits: number;
  lifetimePurchased: number;
  lifetimeConsumed: number;
};

export type AdminCreditGrant = {
  id: string;
  email: string;
  name?: string;
  credits: number;
  balanceAfter: number;
  reason?: string;
  adminEmail?: string;
  createdAt: string;
};

type TargetRow = {
  id: string;
  email: string;
  name: string | null;
  available_credits: string | number;
  reserved_credits: string | number;
  lifetime_purchased: string | number;
  lifetime_consumed: string | number;
};

function toTarget(row: TargetRow): AdminCreditTarget {
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? undefined,
    availableCredits: Number(row.available_credits),
    reservedCredits: Number(row.reserved_credits),
    lifetimePurchased: Number(row.lifetime_purchased),
    lifetimeConsumed: Number(row.lifetime_consumed)
  };
}

export async function findAdminCreditTarget(identifier: string) {
  await ensureCreditAccountSchema();
  const normalized = identifier.trim().toLowerCase();
  const rows = await getSql()`
    select u.id, u.email, u.name,
      coalesce(a.available_credits, 0) as available_credits,
      coalesce(a.reserved_credits, 0) as reserved_credits,
      coalesce(a.lifetime_purchased, 0) as lifetime_purchased,
      coalesce(a.lifetime_consumed, 0) as lifetime_consumed
    from users u
    left join credit_accounts a on a.user_id = u.id
    where lower(u.email) = ${normalized} or u.id::text = ${identifier.trim()}
    limit 1
  ` as TargetRow[];
  return rows[0] ? toTarget(rows[0]) : undefined;
}

export async function listRecentAdminCreditGrants(limit = 20) {
  await ensureCreditAccountSchema();
  const rows = await getSql()`
    select l.id, u.email, u.name, l.credits_delta, l.balance_after,
      l.metadata_json, l.created_at
    from credit_ledger l
    join users u on u.id = l.user_id
    where l.event_type = 'admin_grant'
    order by l.created_at desc
    limit ${Math.max(1, Math.min(50, limit))}
  ` as Array<{
    id: string;
    email: string;
    name: string | null;
    credits_delta: string | number;
    balance_after: string | number;
    metadata_json: { reason?: string; adminEmail?: string } | string | null;
    created_at: Date | string;
  }>;
  return rows.map((row): AdminCreditGrant => {
    let metadata: { reason?: string; adminEmail?: string } = {};
    try {
      metadata = typeof row.metadata_json === "string" ? JSON.parse(row.metadata_json) : row.metadata_json ?? {};
    } catch {
      metadata = {};
    }
    return {
      id: row.id,
      email: row.email,
      name: row.name ?? undefined,
      credits: Number(row.credits_delta),
      balanceAfter: Number(row.balance_after),
      reason: metadata.reason,
      adminEmail: metadata.adminEmail,
      createdAt: new Date(row.created_at).toISOString()
    };
  });
}

export async function grantAdminCredits(input: {
  identifier: string;
  credits: number;
  reason?: string;
  requestId: string;
  adminId: string;
  adminEmail: string;
}) {
  await ensureCreditAccountSchema();
  const target = await findAdminCreditTarget(input.identifier);
  if (!target) throw new Error("USER_NOT_FOUND");
  const sql = getSql();
  await sql`
    insert into credit_accounts (user_id)
    values (${target.id})
    on conflict (user_id) do nothing
  `;
  const sourceId = `admin-grant:${input.requestId}`;
  const rows = await sql`
    with grant_lock as (
      select pg_advisory_xact_lock(hashtext(${sourceId}))
    ), existing as (
      select id from credit_ledger, grant_lock where source_id = ${sourceId}
    ), credited as (
      update credit_accounts account
      set available_credits = account.available_credits + ${input.credits},
        updated_at = now()
      where account.user_id = ${target.id}
        and not exists (select 1 from existing)
      returning account.user_id, account.available_credits
    ), ledger_entry as (
      insert into credit_ledger (
        user_id, event_type, credits_delta, balance_after, source_id, metadata_json
      )
      select user_id, 'admin_grant', ${input.credits}, available_credits, ${sourceId},
        ${JSON.stringify({
          reason: input.reason?.trim() || undefined,
          adminId: input.adminId,
          adminEmail: input.adminEmail,
          recipientEmail: target.email
        })}::jsonb
      from credited
      on conflict (source_id) do nothing
      returning id, balance_after
    )
    select id, balance_after from ledger_entry
  ` as Array<{ id: string; balance_after: string | number }>;
  const account = await findAdminCreditTarget(target.id);
  if (!account) throw new Error("USER_NOT_FOUND");
  return {
    credited: Boolean(rows[0]),
    duplicate: !rows[0],
    grantId: rows[0]?.id,
    account
  };
}
