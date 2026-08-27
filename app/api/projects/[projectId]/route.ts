import { NextResponse } from "next/server";
import { z } from "zod";
import { authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { ensureBriefFaithfulProjectTitle, projectTitleMistakesStyleForSubject } from "@/lib/brief-semantics";
import { getSql, hasDatabaseUrl } from "@/lib/db";
import { getProjectGenerationRequest } from "@/lib/generation-requests";
import { persistGeneratedSceneAssets } from "@/lib/project-mutations";
import { getProjectSnapshot } from "@/lib/project-store";
import { deleteR2Objects } from "@/lib/r2";
import { repairLegacyAutoVisualStyle } from "@/lib/visual-style-inference";

const renameSchema = z.object({ title: z.string().trim().min(1).max(120) });

function routeError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: "项目名称不能为空，且不能超过 120 个字符。" }, { status: 400 });
  }
  console.error(error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

function isVisualStyleGenerationFailure(error?: string) {
  return /候选画面均未通过内容与风格质量检查|visual content and style checks|visual generation did not produce a usable image/iu.test(error ?? "");
}

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  let user;
  try {
    user = await requireCurrentUser();
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    throw error;
  }
  const { projectId } = await context.params;
  let snapshot = await getProjectSnapshot(projectId, user.id);
  if (!snapshot) {
    return NextResponse.json({ error: "项目不存在或已经被删除。" }, { status: 404 });
  }
  const generation = await getProjectGenerationRequest(projectId, user.id);
  const originalPrompt = generation?.prompt
    ?? snapshot.messages.find((message) => message.role === "user")?.content;
  let generationOptions = generation?.options;
  let autoVisualStyleRepaired = false;
  const repairFailedAutoStyle = new URL(request.url).searchParams.get("repairFailedAutoStyle") === "1";
  if (
    repairFailedAutoStyle
    && generation?.status === "failed"
    && isVisualStyleGenerationFailure(generation.error)
    && originalPrompt
  ) {
    const repair = repairLegacyAutoVisualStyle(snapshot.project, originalPrompt, generation.options);
    if (repair) {
      await persistGeneratedSceneAssets(
        repair.project.currentVersion.id,
        repair.project.currentVersion.scenes,
        { replaceImages: true, updateStyles: true }
      );
      if (hasDatabaseUrl()) {
        await getSql()`
          update generation_requests
          set options_json = ${JSON.stringify(repair.options)}::jsonb
          where id = ${generation.id}
            and project_id = ${projectId}
            and user_id = ${user.id}
            and status = 'failed'
        `;
      }
      snapshot = await getProjectSnapshot(projectId, user.id) ?? snapshot;
      generationOptions = repair.options;
      autoVisualStyleRepaired = true;
    }
  }
  if (
    originalPrompt
    && projectTitleMistakesStyleForSubject(
      snapshot.project.title,
      originalPrompt,
      generationOptions?.language !== "英文"
    )
  ) {
    const repairedTitle = ensureBriefFaithfulProjectTitle(
      snapshot.project.title,
      originalPrompt,
      generationOptions?.language !== "英文"
    );
    if (repairedTitle !== snapshot.project.title && hasDatabaseUrl()) {
      await getSql()`
        update projects
        set title = ${repairedTitle}, updated_at = now()
        where id = ${projectId} and user_id = ${user.id}
      `;
      snapshot.project = { ...snapshot.project, title: repairedTitle };
    }
  }
  return NextResponse.json({ ...snapshot, generationOptions, autoVisualStyleRepaired });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const user = await requireCurrentUser();
    if (!hasDatabaseUrl()) return NextResponse.json({ error: "项目重命名需要数据库连接。" }, { status: 409 });
    const { projectId } = await context.params;
    const body = renameSchema.parse(await request.json());
    const rows = await getSql()`
      update projects
      set title = ${body.title}, updated_at = now()
      where id = ${projectId}
        and user_id = ${user.id}
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
    const user = await requireCurrentUser();
    if (!hasDatabaseUrl()) return NextResponse.json({ error: "项目删除需要数据库连接。" }, { status: 409 });
    const { projectId } = await context.params;
    const sql = getSql();
    const active = await sql`
      select id from render_jobs
      where project_id = ${projectId}
        and status in ('queued', 'running')
        and exists (
          select 1 from projects p
          where p.id = render_jobs.project_id
            and p.user_id = ${user.id}
        )
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
      join projects p on p.id = pv.project_id
      where pv.project_id = ${projectId}
        and p.user_id = ${user.id}
      union
      select distinct output_r2_key as r2_key
      from render_jobs rj
      join projects p on p.id = rj.project_id
      where rj.project_id = ${projectId}
        and p.user_id = ${user.id}
        and output_r2_key is not null
    ` as Array<{ r2_key: string }>;
    const deleted = await sql`delete from projects where id = ${projectId} and user_id = ${user.id} returning id` as Array<{ id: string }>;
    if (!deleted[0]) return NextResponse.json({ error: "没有找到项目。" }, { status: 404 });
    try {
      await deleteR2Objects(assets.map((asset) => asset.r2_key));
    } catch (error) {
      console.error("Project deleted, but R2 cleanup failed", { projectId, error });
    }
    return NextResponse.json({ deleted: true, projectId });
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    return routeError(error, "项目删除失败，请稍后重试。");
  }
}
