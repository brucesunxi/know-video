import { createHash } from "node:crypto";
import { getSql, hasDatabaseUrl } from "@/lib/db";
import type { GenerationOptions, GenerationReferenceAsset } from "@/lib/types";

export type GenerationRequestStatus = "pending" | "ready" | "failed";

export type GenerationRequestRecord = {
  id: string;
  status: GenerationRequestStatus;
  projectId?: string;
  engine?: string;
  error?: string;
  updatedAt: string;
};

type GenerationRequestRow = {
  id: string;
  request_fingerprint: string;
  status: GenerationRequestStatus;
  project_id: string | null;
  engine: string | null;
  error: string | null;
  updated_at: Date | string;
};

let schemaPromise: Promise<void> | undefined;

async function ensureGenerationRequestsSchema() {
  if (!hasDatabaseUrl()) return;
  if (!schemaPromise) {
    const sql = getSql();
    schemaPromise = (async () => {
      await sql`
        create table if not exists generation_requests (
          id uuid primary key,
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
        create index if not exists generation_requests_status_updated_idx
        on generation_requests(status, updated_at desc)
      `;
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  await schemaPromise;
}

function toRecord(row: GenerationRequestRow): GenerationRequestRecord {
  return {
    id: row.id,
    status: row.status,
    projectId: row.project_id ?? undefined,
    engine: row.engine ?? undefined,
    error: row.error ?? undefined,
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
  fingerprint: string;
}): Promise<{ claimed: boolean; record?: GenerationRequestRecord; conflict?: boolean }> {
  if (!hasDatabaseUrl()) return { claimed: true };
  await ensureGenerationRequestsSchema();
  const sql = getSql();
  const inserted = await sql`
    insert into generation_requests (id, request_fingerprint, status)
    values (${input.id}, ${input.fingerprint}, 'pending')
    on conflict (id) do nothing
    returning id
  ` as Array<{ id: string }>;
  const rows = await sql`
    select id, request_fingerprint, status, project_id, engine, error, updated_at
    from generation_requests
    where id = ${input.id}
    limit 1
  ` as GenerationRequestRow[];
  const row = rows[0];
  if (!row) throw new Error("生成任务没有成功创建，请重试。");
  if (row.request_fingerprint !== input.fingerprint) {
    return { claimed: false, record: toRecord(row), conflict: true };
  }
  return { claimed: inserted.length > 0, record: toRecord(row) };
}

export async function getGenerationRequest(id: string) {
  if (!hasDatabaseUrl()) return undefined;
  await ensureGenerationRequestsSchema();
  const rows = await getSql()`
    select id, request_fingerprint, status, project_id, engine, error, updated_at
    from generation_requests
    where id = ${id}
    limit 1
  ` as GenerationRequestRow[];
  return rows[0] ? toRecord(rows[0]) : undefined;
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

export async function failGenerationRequest(id: string) {
  if (!hasDatabaseUrl()) return;
  await ensureGenerationRequestsSchema();
  await getSql()`
    update generation_requests
    set status = 'failed', error = '视频脚本和分镜生成没有完成，请重试。', updated_at = now()
    where id = ${id} and status = 'pending'
  `;
}
