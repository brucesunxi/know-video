import { createHash } from "node:crypto";
import {
  buildCreditReservationRefundQuery,
  buildCreditReservationReleaseQuery
} from "@/lib/billing/usage";
import { getSql, hasDatabaseUrl } from "@/lib/db";
import {
  GENERATION_MAX_RUNTIME_MINUTES,
  GENERATION_PLANNING_TIMEOUT_MINUTES,
  generationExceededRuntime
} from "@/lib/generation-lifecycle-policy";
import type { GenerationOptions, GenerationReferenceAsset } from "@/lib/types";

export type GenerationRequestStatus = "pending" | "ready" | "failed";

export type GenerationRequestRecord = {
  id: string;
  status: GenerationRequestStatus;
  prompt?: string;
  options?: GenerationOptions;
  projectId?: string;
  engine?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

type GenerationRequestRow = {
  id: string;
  user_id: string | null;
  prompt: string | null;
  options_json: GenerationOptions | string | null;
  request_fingerprint: string;
  status: GenerationRequestStatus;
  project_id: string | null;
  engine: string | null;
  error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  billing_repair_needed?: boolean;
};

const PLANNING_STALE_INTERVAL = `${GENERATION_PLANNING_TIMEOUT_MINUTES} minutes`;
const ATTACHED_PROJECT_STALE_INTERVAL = `${GENERATION_MAX_RUNTIME_MINUTES} minutes`;
const ATTACHED_PROJECT_STALE_ERROR = "后台生成已达到 40 分钟运行上限，系统已自动停止并退回本次 Credits。请检查并重试缺失场景。";

function publicStoredError(error: string | null) {
  if (!error) return undefined;
  if (/relation .* does not exist|column .* does not exist|operator is not unique|neondberror|sqlstate|42p01|42703|42725/i.test(error)) {
    return "生成服务初始化没有完成，请重试。";
  }
  return error;
}

function toRecord(row: GenerationRequestRow): GenerationRequestRecord {
  let options: GenerationOptions | undefined;
  try {
    options = typeof row.options_json === "string"
      ? JSON.parse(row.options_json) as GenerationOptions
      : row.options_json ?? undefined;
  } catch {
    options = undefined;
  }
  return {
    id: row.id,
    status: row.status,
    prompt: row.prompt ?? undefined,
    options,
    projectId: row.project_id ?? undefined,
    engine: row.engine ?? undefined,
    error: publicStoredError(row.error),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

async function readGenerationRequestRow(id: string, userId: string) {
  const rows = await getSql()`
    select request.*,
      exists (
        select 1
        from credit_reservations reservation
        where reservation.reservation_key = 'project-generation:' || request.id::text
          and reservation.user_id = request.user_id
          and (
            (
              request.status = 'ready'
              and reservation.status in ('reserved', 'partially_settled')
            )
            or (
              request.status = 'failed'
              and (
                reservation.status in ('reserved', 'partially_settled', 'settled')
                or (reservation.status = 'released' and reservation.settled_credits > 0)
              )
            )
          )
      ) as billing_repair_needed
    from generation_requests request
    where request.id = ${id} and request.user_id = ${userId}
    limit 1
  ` as GenerationRequestRow[];
  return rows[0];
}

function requestLooksStale(row: GenerationRequestRow) {
  if (row.status !== "pending") return false;
  if (row.project_id) return generationExceededRuntime(row.created_at);
  const updatedAt = new Date(row.updated_at).getTime();
  return Number.isFinite(updatedAt)
    && Date.now() - updatedAt >= GENERATION_PLANNING_TIMEOUT_MINUTES * 60_000;
}

export function generationRequestFingerprint(
  prompt: string,
  options?: GenerationOptions,
  references: GenerationReferenceAsset[] = []
) {
  return createHash("sha256")
    .update(JSON.stringify({
      prompt: prompt.trim(),
      options: options ?? null,
      references: references.map(({ key, name, size, contentType }) => ({ key, name, size, contentType }))
    }))
    .digest("hex");
}

export async function claimGenerationRequest(input: {
  id: string;
  userId: string;
  fingerprint: string;
  prompt: string;
  options?: GenerationOptions;
}): Promise<{ claimed: boolean; record?: GenerationRequestRecord; conflict?: boolean }> {
  if (!hasDatabaseUrl()) return { claimed: true };
  const sql = getSql();
  const inserted = await sql`
    insert into generation_requests (id, user_id, prompt, options_json, request_fingerprint, status)
    values (${input.id}, ${input.userId}, ${input.prompt.trim().slice(0, 4000)}, ${input.options ? JSON.stringify(input.options) : null}::jsonb, ${input.fingerprint}, 'pending')
    on conflict (id) do nothing
    returning id
  ` as Array<{ id: string }>;
  const rows = await sql`
    select id, user_id, prompt, options_json, request_fingerprint, status, project_id, engine, error, created_at, updated_at
    from generation_requests
    where id = ${input.id}
    limit 1
  ` as GenerationRequestRow[];
  const row = rows[0];
  if (!row) throw new Error("生成任务没有成功创建，请重试。");
  if (row.user_id && row.user_id !== input.userId) {
    return { claimed: false, conflict: true };
  }
  if (row.request_fingerprint !== input.fingerprint) {
    return { claimed: false, record: toRecord(row), conflict: true };
  }
  if (!row.prompt || !row.options_json) {
    const repairedRows = await sql`
      update generation_requests
      set prompt = coalesce(prompt, ${input.prompt.trim().slice(0, 4000)}),
          options_json = coalesce(options_json, ${input.options ? JSON.stringify(input.options) : null}::jsonb),
          updated_at = now()
      where id = ${input.id} and user_id = ${input.userId}
      returning id, user_id, prompt, options_json, request_fingerprint, status, project_id, engine, error, created_at, updated_at
    ` as GenerationRequestRow[];
    return { claimed: inserted.length > 0, record: repairedRows[0] ? toRecord(repairedRows[0]) : toRecord(row) };
  }
  return { claimed: inserted.length > 0, record: toRecord(row) };
}

export async function getGenerationRequest(id: string, userId: string) {
  if (!hasDatabaseUrl()) return undefined;
  let row = await readGenerationRequestRow(id, userId);
  if (!row) return undefined;
  if (requestLooksStale(row) || (row.status === "failed" && row.billing_repair_needed)) {
    await failGenerationRequest({
      id,
      userId,
      error: row.error ?? "生成任务运行超时，请重新提交。",
      refundReason: row.status === "failed"
        ? "terminal_generation_billing_repair"
        : "project_generation_timed_out",
      metadata: row.status === "failed" ? { repairedTerminalBilling: true } : undefined,
      staleOnly: row.status === "pending"
    });
    row = await readGenerationRequestRow(id, userId) ?? row;
  } else if (row.status === "ready" && row.project_id && row.billing_repair_needed) {
    await completeGenerationRequest({
      id,
      userId,
      projectId: row.project_id,
      engine: row.engine ?? "ai",
      releaseReason: "terminal_generation_billing_repair",
      metadata: { repairedTerminalBilling: true }
    });
    row = await readGenerationRequestRow(id, userId) ?? row;
  }
  return toRecord(row);
}

export async function getGenerationRequestBeforeExpiry(id: string, userId: string) {
  if (!hasDatabaseUrl()) return undefined;
  const row = await readGenerationRequestRow(id, userId);
  return row ? toRecord(row) : undefined;
}

export async function listCompletedPendingGenerationRequests(userId: string) {
  if (!hasDatabaseUrl()) return [];
  const rows = await getSql()`
    select
      gr.id,
      gr.user_id,
      gr.prompt,
      gr.options_json,
      gr.request_fingerprint,
      gr.status,
      gr.project_id,
      gr.engine,
      gr.error,
      gr.created_at,
      gr.updated_at
    from generation_requests gr
    join projects p on p.id = gr.project_id and p.user_id = ${userId}
    where gr.user_id = ${userId}
      and gr.status = 'pending'
      and p.current_version_id is not null
      and exists (
        select 1 from scenes scene where scene.version_id = p.current_version_id
      )
      and not exists (
        select 1
        from scenes scene
        where scene.version_id = p.current_version_id
          and (
            not exists (
              select 1
              from scene_assets visual_asset
              where visual_asset.scene_id = scene.id
                and visual_asset.asset_type in ('image', 'clip')
                and coalesce(visual_asset.metadata_json->>'source', '') <> 'fallback-image'
                and coalesce(visual_asset.metadata_json->>'model', '') <> 'local-svg-fallback'
                and coalesce(visual_asset.metadata_json->>'qualityFallback', 'false') <> 'true'
            )
            or not exists (
              select 1
              from scene_assets audio_asset
              where audio_asset.scene_id = scene.id
                and audio_asset.asset_type = 'audio'
            )
          )
      )
    order by gr.updated_at desc
    limit 20
  ` as GenerationRequestRow[];
  return rows.map(toRecord);
}

export async function getProjectGenerationOptions(projectId: string, userId: string) {
  if (!hasDatabaseUrl()) return undefined;
  const rows = await getSql()`
    select id, user_id, prompt, options_json, request_fingerprint, status, project_id, engine, error, created_at, updated_at
    from generation_requests
    where project_id = ${projectId}
      and user_id = ${userId}
      and status in ('pending', 'ready', 'failed')
    order by updated_at desc
    limit 1
  ` as GenerationRequestRow[];
  return rows[0] ? toRecord(rows[0]).options : undefined;
}

export async function getProjectGenerationRequest(projectId: string, userId: string) {
  if (!hasDatabaseUrl()) return undefined;
  const rows = await getSql()`
    select id, user_id, prompt, options_json, request_fingerprint, status, project_id, engine, error, created_at, updated_at
    from generation_requests
    where project_id = ${projectId}
      and user_id = ${userId}
      and status in ('pending', 'ready', 'failed')
    order by updated_at desc
    limit 1
  ` as GenerationRequestRow[];
  return rows[0] ? toRecord(rows[0]) : undefined;
}

export async function listIncompleteGenerationRequests(userId: string) {
  if (!hasDatabaseUrl()) return [];
  const sql = getSql();
  const repairCandidates = await sql`
    select request.*
    from generation_requests request
    left join credit_reservations reservation
      on reservation.reservation_key = 'project-generation:' || request.id::text
      and reservation.user_id = request.user_id
    where request.user_id = ${userId}
      and (
        (
          request.status = 'pending'
          and (
            (request.project_id is null and request.updated_at < now() - ${PLANNING_STALE_INTERVAL}::interval)
            or (request.project_id is not null and request.created_at < now() - ${ATTACHED_PROJECT_STALE_INTERVAL}::interval)
          )
        )
        or (
          request.status = 'ready'
          and reservation.status in ('reserved', 'partially_settled')
        )
        or (
          request.status = 'failed'
          and (
            reservation.status in ('reserved', 'partially_settled', 'settled')
            or (reservation.status = 'released' and reservation.settled_credits > 0)
          )
        )
      )
    order by request.updated_at
    limit 50
  ` as GenerationRequestRow[];
  await Promise.all(repairCandidates.map(async (request) => {
    if (request.status === "ready" && request.project_id) {
      await completeGenerationRequest({
        id: request.id,
        userId,
        projectId: request.project_id,
        engine: request.engine ?? "ai",
        releaseReason: "terminal_generation_billing_repair",
        metadata: { repairedTerminalBilling: true }
      });
      return;
    }
    await failGenerationRequest({
      id: request.id,
      userId,
      error: request.error ?? "生成任务运行超时，请重新提交。",
      refundReason: request.status === "failed"
        ? "terminal_generation_billing_repair"
        : "project_generation_timed_out",
      metadata: request.status === "failed" ? { repairedTerminalBilling: true } : undefined,
      staleOnly: request.status === "pending"
    });
  }));
  const rows = await sql`
    select id, user_id, prompt, options_json, request_fingerprint, status, project_id, engine, error, created_at, updated_at
    from generation_requests
    where user_id = ${userId} and status in ('pending', 'failed')
    order by updated_at desc
    limit 50
  ` as GenerationRequestRow[];
  return rows.map(toRecord);
}

export async function deleteFailedGenerationRequest(id: string, userId: string) {
  if (!hasDatabaseUrl()) return false;
  const sql = getSql();
  const results = await sql.transaction([
    sql`select pg_advisory_xact_lock(hashtextextended(${id}, 1))`,
    buildCreditReservationRefundQuery(sql, {
      userId,
      reservationKey: `project-generation:${id}`,
      reason: "failed_generation_deleted",
      metadata: { deletedFailureNotice: true }
    }, {
      requestId: id,
      status: "failed"
    }),
    sql`
      delete from generation_requests
      where id = ${id}
        and user_id = ${userId}
        and status = 'failed'
      returning id
    `
  ]);
  const rows = results[2] as Array<{ id: string }>;
  return rows.length > 0;
}

export async function completeGenerationRequest(input: {
  id: string;
  userId: string;
  projectId: string;
  engine: string;
  billingReservationKey?: string;
  releaseReason?: string;
  metadata?: Record<string, unknown>;
}) {
  if (!hasDatabaseUrl()) return { completed: false, releasedCredits: 0 } as const;
  const sql = getSql();
  const reservationKey = input.billingReservationKey ?? `project-generation:${input.id}`;
  const results = await sql.transaction([
    sql`select pg_advisory_xact_lock(hashtextextended(${input.id}, 1))`,
    sql`
      update generation_requests
      set status = 'ready', project_id = ${input.projectId}, engine = ${input.engine}, error = null, updated_at = now()
      where id = ${input.id}
        and user_id = ${input.userId}
        and status = 'pending'
      returning id
    `,
    buildCreditReservationReleaseQuery(sql, {
      userId: input.userId,
      reservationKey,
      reason: input.releaseReason ?? "project_generation_completed",
      metadata: { projectId: input.projectId, ...input.metadata }
    }, {
      requestId: input.id,
      status: "ready",
      projectId: input.projectId
    })
  ]);
  const completed = (results[1] as Array<{ id: string }>).length > 0;
  const released = (results[2] as Array<{ released_credits: string | number }>)[0];
  return {
    completed,
    releasedCredits: Number(released?.released_credits ?? 0)
  } as const;
}

export async function attachGenerationRequestProject(input: {
  id: string;
  projectId: string;
  engine: string;
}) {
  if (!hasDatabaseUrl()) return;
  await getSql()`
    update generation_requests
    set project_id = ${input.projectId}, engine = ${input.engine}, error = null, updated_at = now()
    where id = ${input.id} and status = 'pending'
  `;
}

export async function touchGenerationRequest(id: string) {
  if (!hasDatabaseUrl()) return { pending: true as const };
  const rows = await getSql()`
    update generation_requests
    set updated_at = now()
    where id = ${id} and status = 'pending'
    returning id, created_at
  ` as Array<{ id: string; created_at: string | Date }>;
  const row = rows[0];
  return row
    ? { pending: true as const, createdAt: new Date(row.created_at).toISOString() }
    : { pending: false as const };
}

export async function failGenerationRequest(input: {
  id: string;
  userId: string;
  error?: string;
  billingReservationKey?: string;
  refundReason: string;
  metadata?: Record<string, unknown>;
  staleOnly?: boolean;
}) {
  if (!hasDatabaseUrl()) return { failed: false, refundedCredits: 0 } as const;
  const safeError = (input.error ?? "视频脚本和分镜生成没有完成，请重试。")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500) || "视频脚本和分镜生成没有完成，请重试。";
  const sql = getSql();
  const reservationKey = input.billingReservationKey ?? `project-generation:${input.id}`;
  const staleOnly = input.staleOnly === true;
  const results = await sql.transaction([
    sql`select pg_advisory_xact_lock(hashtextextended(${input.id}, 1))`,
    sql`
      update generation_requests
      set status = 'failed',
        error = case
          when ${staleOnly} and project_id is not null then ${ATTACHED_PROJECT_STALE_ERROR}
          else ${safeError}
        end,
        updated_at = now()
      where id = ${input.id}
        and user_id = ${input.userId}
        and status = 'pending'
        and (
          ${staleOnly} = false
          or (project_id is null and updated_at < now() - ${PLANNING_STALE_INTERVAL}::interval)
          or (project_id is not null and created_at < now() - ${ATTACHED_PROJECT_STALE_INTERVAL}::interval)
        )
      returning id
    `,
    buildCreditReservationRefundQuery(sql, {
      userId: input.userId,
      reservationKey,
      reason: input.refundReason,
      metadata: input.metadata
    }, {
      requestId: input.id,
      status: "failed"
    })
  ]);
  const failed = (results[1] as Array<{ id: string }>).length > 0;
  const refunded = (results[2] as Array<{
    refund_credits: string | number;
    consumed_credits_refund: string | number;
  }>)[0];
  return {
    failed,
    refundedCredits: Number(refunded?.refund_credits ?? 0),
    reversedSettledCredits: Number(refunded?.consumed_credits_refund ?? 0)
  } as const;
}
