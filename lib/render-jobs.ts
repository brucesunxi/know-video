import { getSql, hasDatabaseUrl } from "@/lib/db";
import { assetUrlForKey } from "@/lib/r2";
import { versionStatusAfterRenderJob } from "@/lib/render-lifecycle";
import { deleteUnreferencedStorageObjects } from "@/lib/storage-cleanup";
import type { RenderJob } from "@/lib/types";

type RenderJobRow = {
  id: string;
  project_id: string;
  version_id: string;
  status: RenderJob["status"];
  progress: number;
  error: string | null;
  output_r2_key: string | null;
  metadata_json: unknown;
  created_at: Date | string;
  updated_at: Date | string;
  version_label?: string | null;
};

let metadataColumnAvailable: boolean | undefined;

function toRenderJob(row: RenderJobRow): RenderJob {
  return {
    id: row.id,
    projectId: row.project_id,
    versionId: row.version_id,
    status: row.status,
    progress: row.progress,
    error: row.error ?? undefined,
    outputR2Key: row.output_r2_key ?? undefined,
    renderUrl: row.output_r2_key ? assetUrlForKey(row.output_r2_key) : undefined,
    metadata: row.metadata_json && typeof row.metadata_json === "object"
      ? row.metadata_json as Record<string, unknown>
      : undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    versionLabel: row.version_label ?? undefined
  };
}

async function renderJobMetadataColumnExists(sql: ReturnType<typeof getSql>) {
  if (metadataColumnAvailable !== undefined) return metadataColumnAvailable;
  const rows = await sql`
    select exists (
      select 1
      from information_schema.columns
      where table_name = 'render_jobs'
        and column_name = 'metadata_json'
    ) as exists
  ` as Array<{ exists: boolean }>;
  metadataColumnAvailable = Boolean(rows[0]?.exists);
  return metadataColumnAvailable;
}

export async function invalidateVersionRender(versionId: string) {
  if (!hasDatabaseUrl()) return;
  const sql = getSql();
  const results = await sql.transaction([
    sql`
      update project_versions
      set render_url = null,
          status = case when status in ('rendering', 'ready') then 'draft' else status end
      where id = ${versionId}
    `,
    sql`
      with obsolete as (
        select id, output_r2_key
        from render_jobs
        where version_id = ${versionId}
          and status in ('queued', 'running', 'ready')
        for update
      ),
      cancelled as (
      update render_jobs
      set status = 'cancelled',
          error = '场景素材已更新，需要重新导出。',
          output_r2_key = null,
          updated_at = now()
        from obsolete
        where render_jobs.id = obsolete.id
        returning obsolete.output_r2_key as previous_output_r2_key
      )
      select previous_output_r2_key from cancelled
    `
  ]);
  const obsoleteKeys = (results[1] as Array<{ previous_output_r2_key: string | null }>)
    .flatMap((row) => row.previous_output_r2_key ? [row.previous_output_r2_key] : []);
  await deleteUnreferencedStorageObjects(obsoleteKeys).catch((error) => {
    console.error("[render-jobs] Unable to clean invalidated render outputs:", error);
  });
}

export async function acquireRenderJob(projectId: string, versionId: string): Promise<{
  renderJob: RenderJob;
  reused: boolean;
} | undefined> {
  if (!hasDatabaseUrl()) {
    return {
      renderJob: { id: crypto.randomUUID(), projectId, versionId, status: "queued", progress: 0 },
      reused: false
    };
  }
  const sql = getSql();
  const results = await sql.transaction([
    sql`select pg_advisory_xact_lock(hashtextextended(${versionId}, 0))`,
    sql`
      update render_jobs
      set status = 'failed',
          progress = 0,
          error = '渲染任务超时，已允许重新导出。',
          updated_at = now()
      where project_id = ${projectId}
        and version_id = ${versionId}
        and (
          (status = 'queued' and updated_at < now() - interval '5 minutes')
          or (status = 'running' and updated_at < now() - interval '50 minutes')
        )
    `,
    sql`
      select render_jobs.*
      from render_jobs
      where project_id = ${projectId}
        and version_id = ${versionId}
        and exists (
          select 1
          from projects
          where projects.id = ${projectId}
            and projects.current_version_id = ${versionId}
        )
        and (
          status in ('queued', 'running')
          or (status = 'ready' and output_r2_key is not null)
        )
      order by
        case status when 'running' then 0 when 'queued' then 1 else 2 end,
        created_at desc
      limit 1
    `,
    sql`
      insert into render_jobs (project_id, version_id, status, progress)
      select ${projectId}, ${versionId}, 'queued', 0
      where exists (
        select 1
        from projects
        where projects.id = ${projectId}
          and projects.current_version_id = ${versionId}
      )
        and not exists (
          select 1
          from render_jobs
          where project_id = ${projectId}
            and version_id = ${versionId}
            and (
              status in ('queued', 'running')
              or (status = 'ready' and output_r2_key is not null)
            )
        )
      returning *
    `
  ]);
  const reusable = (results[2] as RenderJobRow[])[0];
  if (reusable) return { renderJob: toRenderJob(reusable), reused: true };
  const created = (results[3] as RenderJobRow[])[0];
  return created ? { renderJob: toRenderJob(created), reused: false } : undefined;
}

export async function getRenderJob(jobId: string) {
  if (!hasDatabaseUrl()) return undefined;
  const sql = getSql();
  const rows = await sql`select * from render_jobs where id = ${jobId} limit 1` as RenderJobRow[];
  return rows[0] ? toRenderJob(rows[0]) : undefined;
}

export async function listRenderJobs(projectId: string, limit = 20) {
  if (!hasDatabaseUrl()) return [];
  const sql = getSql();
  const safeLimit = Math.min(50, Math.max(1, limit));
  const rows = await sql`
    select render_jobs.*, project_versions.label as version_label
    from render_jobs
    join project_versions on project_versions.id = render_jobs.version_id
    where render_jobs.project_id = ${projectId}
      and exists (select 1 from projects where projects.id = ${projectId})
    order by render_jobs.created_at desc
    limit ${safeLimit}
  ` as RenderJobRow[];
  return rows.map(toRenderJob);
}

export async function cancelRenderJob(projectId: string, jobId: string) {
  if (!hasDatabaseUrl()) return undefined;
  const sql = getSql();
  const results = await sql.transaction([
    sql`select pg_advisory_xact_lock(hashtextextended(${jobId}, 0))`,
    sql`
      with target as (
        select id
        from render_jobs
        where id = ${jobId}
          and project_id = ${projectId}
          and status in ('queued', 'running')
        for update
      )
      update render_jobs
      set status = 'cancelled',
          progress = 0,
          error = '用户已取消本次导出。',
          output_r2_key = null,
          updated_at = now()
      from target
      where render_jobs.id = target.id
      returning render_jobs.*
    `,
    sql`
      update project_versions
      set status = 'draft', render_url = null
      where id = (
        select version_id from render_jobs
        where id = ${jobId} and project_id = ${projectId} and status = 'cancelled'
      )
        and status = 'rendering'
        and exists (
          select 1 from projects
          where projects.id = ${projectId}
            and projects.current_version_id = project_versions.id
        )
    `
  ]);
  const row = (results[1] as RenderJobRow[])[0];
  return row ? toRenderJob(row) : undefined;
}

export async function invalidateReadyRenderJob(jobId: string, reason: string) {
  if (!hasDatabaseUrl()) return undefined;
  const sql = getSql();
  const results = await sql.transaction([
    sql`select pg_advisory_xact_lock(hashtextextended(${jobId}, 0))`,
    sql`
      with target as (
        select id, output_r2_key
        from render_jobs
        where id = ${jobId}
          and status = 'ready'
        for update
      ), invalidated as (
        update render_jobs
        set status = 'failed',
            progress = 0,
            error = ${reason},
            output_r2_key = null,
            updated_at = now()
        from target
        where render_jobs.id = target.id
        returning render_jobs.*, target.output_r2_key as previous_output_r2_key
      )
      select * from invalidated
    `,
    sql`
      update project_versions
      set status = 'draft', render_url = null
      where id = (select version_id from render_jobs where id = ${jobId} and status = 'failed')
        and exists (
          select 1 from projects
          where projects.id = project_versions.project_id
            and projects.current_version_id = project_versions.id
        )
    `
  ]);
  const row = (results[1] as Array<RenderJobRow & { previous_output_r2_key: string | null }>)[0];
  if (!row) return undefined;
  if (row.previous_output_r2_key) {
    await deleteUnreferencedStorageObjects([row.previous_output_r2_key]).catch((error) => {
      console.error("[render-jobs] Unable to clean invalid render output:", error);
    });
  }
  return toRenderJob(row);
}

export async function updateRenderJob(input: {
  jobId: string;
  status: RenderJob["status"];
  progress: number;
  error?: string;
  outputR2Key?: string;
  metadata?: Record<string, unknown>;
}) {
  if (!hasDatabaseUrl()) return undefined;
  const sql = getSql();
  const versionStatus = versionStatusAfterRenderJob(input.status);
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;
  const canStoreMetadata = await renderJobMetadataColumnExists(sql);
  const updateJob = canStoreMetadata ? sql`
    update render_jobs
    set status = ${input.status},
        progress = ${input.progress},
        error = ${input.error ?? null},
        output_r2_key = coalesce(${input.outputR2Key ?? null}, output_r2_key),
        metadata_json = case
          when ${metadataJson}::jsonb is not null then ${metadataJson}::jsonb
          when ${input.status} in ('failed', 'cancelled') then '{}'
          else metadata_json
        end,
        updated_at = now()
    where id = ${input.jobId}
      and (
        ${input.status} in ('failed', 'cancelled')
        or exists (
          select 1
          from projects
          where projects.id = render_jobs.project_id
            and projects.current_version_id = render_jobs.version_id
        )
      )
      and (
        (
          ${input.status} = 'running'
          and status in ('queued', 'running')
          and progress <= ${input.progress}
        )
        or (
          ${input.status} in ('ready', 'failed', 'cancelled')
          and status in ('queued', 'running')
        )
      )
    returning *
  ` : sql`
    update render_jobs
    set status = ${input.status},
        progress = ${input.progress},
        error = ${input.error ?? null},
        output_r2_key = coalesce(${input.outputR2Key ?? null}, output_r2_key),
        updated_at = now()
    where id = ${input.jobId}
      and (
        ${input.status} in ('failed', 'cancelled')
        or exists (
          select 1
          from projects
          where projects.id = render_jobs.project_id
            and projects.current_version_id = render_jobs.version_id
        )
      )
      and (
        (
          ${input.status} = 'running'
          and status in ('queued', 'running')
          and progress <= ${input.progress}
        )
        or (
          ${input.status} in ('ready', 'failed', 'cancelled')
          and status in ('queued', 'running')
        )
      )
    returning *
  `;
  const results = await sql.transaction([
    updateJob,
    versionStatus ? sql`
      update project_versions
      set
        status = ${versionStatus},
        render_url = case
          when ${input.status} = 'ready' then ${input.outputR2Key ? assetUrlForKey(input.outputR2Key) : null}
          when ${input.status} in ('failed', 'cancelled') then null
          else render_url
        end
      where id = (
        select version_id
        from render_jobs
        where id = ${input.jobId}
          and status = ${input.status}
      )
        and exists (
          select 1
          from projects
          where projects.id = project_versions.project_id
            and projects.current_version_id = project_versions.id
        )
    ` : sql`select 1 where false`
  ]);
  const row = (results[0] as RenderJobRow[])[0];
  return row ? toRenderJob(row) : undefined;
}
