import { getSql, hasDatabaseUrl } from "@/lib/db";
import { assetUrlForKey } from "@/lib/r2";
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

export async function createRenderJob(projectId: string, versionId: string) {
  if (!hasDatabaseUrl()) {
    return { id: crypto.randomUUID(), projectId, versionId, status: "queued", progress: 0 } satisfies RenderJob;
  }
  const sql = getSql();
  const rows = await sql`
    insert into render_jobs (project_id, version_id, status, progress)
    values (${projectId}, ${versionId}, 'queued', 0)
    returning *
  ` as RenderJobRow[];
  return toRenderJob(rows[0]);
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
  const rows = await sql`
    update render_jobs
    set status = ${input.status},
        progress = ${input.progress},
        error = ${input.error ?? null},
        output_r2_key = coalesce(${input.outputR2Key ?? null}, output_r2_key),
        updated_at = now()
    where id = ${input.jobId}
    returning *
  ` as RenderJobRow[];
  const row = rows[0];
  if (row && input.status === "ready" && row.output_r2_key) {
    await sql`
      update project_versions
      set status = 'ready', render_url = ${assetUrlForKey(row.output_r2_key)}
      where id = ${row.version_id}
    `;
  } else if (row && input.status === "failed") {
    await sql`update project_versions set status = 'failed' where id = ${row.version_id}`;
  }
  return row ? toRenderJob(row) : undefined;
}

