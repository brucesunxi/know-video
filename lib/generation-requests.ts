import { createHash } from "node:crypto";
import { refundCreditReservation } from "@/lib/billing/usage";
import { getSql, hasDatabaseUrl } from "@/lib/db";
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
};

let schemaPromise: Promise<void> | undefined;
const ATTACHED_PROJECT_STALE_INTERVAL = "45 minutes";

function publicStoredError(error: string | null) {
  if (!error) return undefined;
  if (/relation .* does not exist|column .* does not exist|operator is not unique|neondberror|sqlstate|42p01|42703|42725/i.test(error)) {
    return "生成服务初始化没有完成，请重试。";
  }
  return error;
}

async function ensureGenerationRequestsSchema() {
  if (!hasDatabaseUrl()) return;
  if (!schemaPromise) {
    const sql = getSql();
    schemaPromise = (async () => {
      await sql`
        create table if not exists generation_requests (
          id uuid primary key,
          user_id uuid references users(id) on delete cascade,
          prompt text,
          request_fingerprint text not null,
          status text not null check (status in ('pending', 'ready', 'failed')),
          project_id uuid references projects(id) on delete set null,
          engine text,
          error text,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `;
      await sql`
        alter table generation_requests
        add column if not exists user_id uuid references users(id) on delete cascade
      `;
      await sql`
        alter table generation_requests
        add column if not exists prompt text
      `;
      await sql`
        alter table generation_requests
        add column if not exists options_json jsonb
      `;
      await sql`
        create index if not exists generation_requests_status_updated_idx
        on generation_requests(status, updated_at desc)
      `;
      await sql`
        create index if not exists generation_requests_user_status_updated_idx
        on generation_requests(user_id, status, updated_at desc)
      `;
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  await schemaPromise;
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
  await ensureGenerationRequestsSchema();
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
  await ensureGenerationRequestsSchema();
  const sql = getSql();
  const expired = await sql`
    update generation_requests
    set status = 'failed', error = '生成任务运行超时，请重新提交。', updated_at = now()
    where id = ${id}
      and user_id = ${userId}
      and status = 'pending'
      and (
        (project_id is null and updated_at < now() - interval '15 minutes')
        or (project_id is not null and updated_at < now() - ${ATTACHED_PROJECT_STALE_INTERVAL}::interval)
      )
    returning id
  ` as Array<{ id: string }>;
  if (expired[0]) {
    await refundCreditReservation({
      userId,
      reservationKey: `project-generation:${expired[0].id}`,
      reason: "project_generation_timed_out"
    }).catch((error) => console.error("[generation-requests] Unable to refund timed-out generation:", error));
  }
  const rows = await sql`
    select id, user_id, prompt, options_json, request_fingerprint, status, project_id, engine, error, created_at, updated_at
    from generation_requests
    where id = ${id} and user_id = ${userId}
    limit 1
  ` as GenerationRequestRow[];
  return rows[0] ? toRecord(rows[0]) : undefined;
}

export async function getGenerationRequestBeforeExpiry(id: string, userId: string) {
  if (!hasDatabaseUrl()) return undefined;
  await ensureGenerationRequestsSchema();
  const rows = await getSql()`
    select id, user_id, prompt, options_json, request_fingerprint, status, project_id, engine, error, created_at, updated_at
    from generation_requests
    where id = ${id} and user_id = ${userId}
    limit 1
  ` as GenerationRequestRow[];
  return rows[0] ? toRecord(rows[0]) : undefined;
}

export async function listCompletedPendingGenerationRequests(userId: string) {
  if (!hasDatabaseUrl()) return [];
  await ensureGenerationRequestsSchema();
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
  await ensureGenerationRequestsSchema();
  const rows = await getSql()`
    select id, user_id, prompt, options_json, request_fingerprint, status, project_id, engine, error, created_at, updated_at
    from generation_requests
    where project_id = ${projectId}
      and user_id = ${userId}
      and status in ('pending', 'ready')
    order by updated_at desc
    limit 1
  ` as GenerationRequestRow[];
  return rows[0] ? toRecord(rows[0]).options : undefined;
}

export async function getProjectGenerationRequest(projectId: string, userId: string) {
  if (!hasDatabaseUrl()) return undefined;
  await ensureGenerationRequestsSchema();
  const rows = await getSql()`
    select id, user_id, prompt, options_json, request_fingerprint, status, project_id, engine, error, created_at, updated_at
    from generation_requests
    where project_id = ${projectId}
      and user_id = ${userId}
      and status in ('pending', 'ready')
    order by updated_at desc
    limit 1
  ` as GenerationRequestRow[];
  return rows[0] ? toRecord(rows[0]) : undefined;
}

export async function listIncompleteGenerationRequests(userId: string) {
  if (!hasDatabaseUrl()) return [];
  await ensureGenerationRequestsSchema();
  const sql = getSql();
  const expired = await sql`
    update generation_requests
    set status = 'failed', error = '生成任务运行超时，请重新提交。', updated_at = now()
    where user_id = ${userId}
      and status = 'pending'
      and (
        (project_id is null and updated_at < now() - interval '15 minutes')
        or (project_id is not null and updated_at < now() - ${ATTACHED_PROJECT_STALE_INTERVAL}::interval)
      )
    returning id
  ` as Array<{ id: string }>;
  await Promise.all(expired.map((request) => refundCreditReservation({
    userId,
    reservationKey: `project-generation:${request.id}`,
    reason: "project_generation_timed_out"
  }).catch((error) => console.error("[generation-requests] Unable to refund timed-out generation:", error))));
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
  await ensureGenerationRequestsSchema();
  const rows = await getSql()`
    delete from generation_requests
    where id = ${id}
      and user_id = ${userId}
      and status = 'failed'
    returning id
  ` as Array<{ id: string }>;
  return rows.length > 0;
}

export async function completeGenerationRequest(input: {
  id: string;
  projectId: string;
  engine: string;
}) {
  if (!hasDatabaseUrl()) return;
  await ensureGenerationRequestsSchema();
  await getSql()`
    update generation_requests
    set status = 'ready', project_id = ${input.projectId}, engine = ${input.engine}, error = null, updated_at = now()
    where id = ${input.id} and status = 'pending'
  `;
}

export async function attachGenerationRequestProject(input: {
  id: string;
  projectId: string;
  engine: string;
}) {
  if (!hasDatabaseUrl()) return;
  await ensureGenerationRequestsSchema();
  await getSql()`
    update generation_requests
    set project_id = ${input.projectId}, engine = ${input.engine}, error = null, updated_at = now()
    where id = ${input.id} and status = 'pending'
  `;
}

export async function touchGenerationRequest(id: string) {
  if (!hasDatabaseUrl()) return;
  await ensureGenerationRequestsSchema();
  await getSql()`
    update generation_requests
    set updated_at = now()
    where id = ${id} and status = 'pending'
  `;
}

export async function failGenerationRequest(id: string, error = "视频脚本和分镜生成没有完成，请重试。") {
  if (!hasDatabaseUrl()) return;
  await ensureGenerationRequestsSchema();
  const safeError = error.replace(/\s+/g, " ").trim().slice(0, 500) || "视频脚本和分镜生成没有完成，请重试。";
  await getSql()`
    update generation_requests
    set status = 'failed', error = ${safeError}, updated_at = now()
    where id = ${id} and status = 'pending'
  `;
}
