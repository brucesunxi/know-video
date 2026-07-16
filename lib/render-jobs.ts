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
  created_at: Date | string;
  updated_at: Date | string;
};

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
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
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

export async function updateRenderJob(input: {
  jobId: string;
  status: RenderJob["status"];
  progress: number;
  error?: string;
  outputR2Key?: string;
}) {
  if (!hasDatabaseUrl()) return undefined;
  const sql = getSql();
  const versionStatus = versionStatusAfterRenderJob(input.status);
  const results = await sql.transaction([
    sql`
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
    `,
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
