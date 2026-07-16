import { NextResponse } from "next/server";
import { z } from "zod";
import { getSql, hasDatabaseUrl } from "@/lib/db";
import { getProjectSnapshot } from "@/lib/project-store";
import { deleteR2Objects } from "@/lib/r2";

const renameSchema = z.object({ title: z.string().trim().min(1).max(120) });

function routeError(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: "项目名称不能为空，且不能超过 120 个字符。" }, { status: 400 });
  }
  console.error(error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await context.params;
  const snapshot = await getProjectSnapshot(projectId);
  if (!snapshot) {
    return NextResponse.json({ error: "项目不存在或已经被删除。" }, { status: 404 });
  }
  return NextResponse.json(snapshot);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    if (!hasDatabaseUrl()) return NextResponse.json({ error: "项目重命名需要数据库连接。" }, { status: 409 });
    const { projectId } = await context.params;
    const body = renameSchema.parse(await request.json());
    const rows = await getSql()`
      update projects
      set title = ${body.title}, updated_at = now()
      where id = ${projectId}
      returning id, title, updated_at
    ` as Array<{ id: string; title: string; updated_at: Date | string }>;
    if (!rows[0]) return NextResponse.json({ error: "没有找到项目。" }, { status: 404 });
    return NextResponse.json({
      project: { id: rows[0].id, title: rows[0].title, updatedAt: new Date(rows[0].updated_at).toISOString() }
    });
  } catch (error) {
    return routeError(error, "项目重命名失败，请稍后重试。");
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    if (!hasDatabaseUrl()) return NextResponse.json({ error: "项目删除需要数据库连接。" }, { status: 409 });
    const { projectId } = await context.params;
    const sql = getSql();
    const active = await sql`
      select id from render_jobs
      where project_id = ${projectId} and status in ('queued', 'running')
      limit 1
    ` as Array<{ id: string }>;
    if (active[0]) {
      return NextResponse.json({ error: "项目正在导出，请等待任务完成后再删除。" }, { status: 409 });
    }
    const assets = await sql`
      select distinct r2_key
      from scene_assets sa
      join scenes s on s.id = sa.scene_id
      join project_versions pv on pv.id = s.version_id
      where pv.project_id = ${projectId}
      union
      select distinct output_r2_key as r2_key
      from render_jobs
      where project_id = ${projectId} and output_r2_key is not null
    ` as Array<{ r2_key: string }>;
    const deleted = await sql`delete from projects where id = ${projectId} returning id` as Array<{ id: string }>;
    if (!deleted[0]) return NextResponse.json({ error: "没有找到项目。" }, { status: 404 });
    try {
      await deleteR2Objects(assets.map((asset) => asset.r2_key));
    } catch (error) {
      console.error("Project deleted, but R2 cleanup failed", { projectId, error });
    }
    return NextResponse.json({ deleted: true, projectId });
  } catch (error) {
    return routeError(error, "项目删除失败，请稍后重试。");
  }
}
