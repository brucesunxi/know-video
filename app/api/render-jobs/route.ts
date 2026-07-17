import { after, NextResponse } from "next/server";
import { z } from "zod";
import { loadCurrentProjectForEdit } from "@/lib/project-mutations";
import { publicRenderError, renderOutputMetadataIssue, renderSandboxName } from "@/lib/render-lifecycle";
import { renderInputMetadataIssue, renderInputReadiness } from "@/lib/render-preflight";
import { acquireRenderJob, cancelRenderJob, getRenderJob, invalidateReadyRenderJob, listRenderJobs, updateRenderJob } from "@/lib/render-jobs";
import { headR2Object } from "@/lib/r2";
import { startSandboxRender, stopRenderSandbox } from "@/lib/vercel-renderer";

const requestSchema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid()
});

const cancelSchema = z.object({
  projectId: z.string().uuid(),
  jobId: z.string().uuid()
});

function publicRenderJob(renderJob: Awaited<ReturnType<typeof getRenderJob>>) {
  if (!renderJob || !["failed", "cancelled"].includes(renderJob.status)) return renderJob;
  return {
    ...renderJob,
    error: publicRenderError(renderJob.status, renderJob.error)
  };
}

export const maxDuration = 300;

function isMissingRenderObject(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.$metadata?.httpStatusCode === 404
    || [candidate.name, candidate.Code].some((value) => value === "NotFound" || value === "NoSuchKey");
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const jobId = searchParams.get("id");
  const projectId = searchParams.get("projectId");
  if (projectId) {
    if (!z.string().uuid().safeParse(projectId).success) {
      return NextResponse.json({ error: "项目 ID 无效。" }, { status: 400 });
    }
    return NextResponse.json({ renderJobs: (await listRenderJobs(projectId)).map(publicRenderJob) });
  }
  if (!jobId || !z.string().uuid().safeParse(jobId).success) {
    return NextResponse.json({ error: "缺少有效的渲染任务 ID。" }, { status: 400 });
  }
  const renderJob = await getRenderJob(jobId);
  return renderJob
    ? NextResponse.json({ renderJob: publicRenderJob(renderJob) })
    : NextResponse.json({ error: "没有找到渲染任务。" }, { status: 404 });
}

export async function DELETE(request: Request) {
  const parsed = cancelSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return NextResponse.json({ error: "取消导出请求格式无效。" }, { status: 400 });
  }
  const renderJob = await cancelRenderJob(parsed.data.projectId, parsed.data.jobId);
  if (!renderJob) {
    const existing = await getRenderJob(parsed.data.jobId);
    if (existing?.projectId === parsed.data.projectId && existing.status === "cancelled") {
      return NextResponse.json({ renderJob: publicRenderJob(existing) });
    }
    return NextResponse.json({ error: "导出任务已结束或不存在，无法取消。" }, { status: 409 });
  }
  after(() => stopRenderSandbox(renderSandboxName(renderJob.id)).catch((error) => {
    console.error("[render-jobs] Unable to stop cancelled render sandbox:", error);
  }));
  return NextResponse.json({ renderJob: publicRenderJob(renderJob) });
}
export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return NextResponse.json({ error: "导出请求格式无效。" }, { status: 400 });
  }
  const body = parsed.data;
  const project = await loadCurrentProjectForEdit(body.projectId, body.versionId);
  if (!project) {
    return NextResponse.json(
      { error: "视频版本已经发生变化，请刷新后导出当前版本。" },
      { status: 409 }
    );
  }
  const readiness = renderInputReadiness(project);
  if (!readiness.ready) {
    return NextResponse.json(
      { error: readiness.error ?? "视频素材尚未完整，请补齐画面和配音后再导出。" },
      { status: 409 }
    );
  }
  let acquired = await acquireRenderJob(body.projectId, body.versionId);
  if (!acquired) {
    return NextResponse.json(
      { error: "视频版本已经发生变化，请刷新后导出当前版本。" },
      { status: 409 }
    );
  }
  if (acquired.reused && acquired.renderJob.status === "ready" && acquired.renderJob.outputR2Key) {
    let invalidReason: string | undefined;
    try {
      invalidReason = renderOutputMetadataIssue(await headR2Object(acquired.renderJob.outputR2Key));
    } catch (error) {
      if (isMissingRenderObject(error)) {
        invalidReason = "云端成片文件已经不存在。";
      } else {
        console.error("[render-jobs] Unable to verify existing render output:", error);
        return NextResponse.json(
          { error: "暂时无法确认云端成片状态，请稍后重试，现有成片不会被删除。" },
          { status: 503 }
        );
      }
    }
    if (invalidReason) {
      await invalidateReadyRenderJob(acquired.renderJob.id, invalidReason);
      acquired = await acquireRenderJob(body.projectId, body.versionId);
      if (!acquired) {
        return NextResponse.json(
          { error: "旧成片已经失效，但新的导出任务未能创建，请稍后重试。" },
          { status: 503 }
        );
      }
    }
  }
  if (acquired.reused) {
    return NextResponse.json(
      { renderJob: publicRenderJob(acquired.renderJob), reused: true },
      { status: acquired.renderJob.status === "ready" ? 200 : 202 }
    );
  }
  const renderJob = acquired.renderJob;
  const invalidMedia: Array<{ sceneNumber: number; type: "visual" | "audio"; reason: string }> = [];
  let transientStorageError = false;
  await Promise.all(readiness.inputs.map(async (input) => {
    if (!input.asset.r2Key) {
      invalidMedia.push({ sceneNumber: input.sceneNumber, type: input.role, reason: "没有云端文件" });
      return;
    }
    try {
      const issue = renderInputMetadataIssue(input, await headR2Object(input.asset.r2Key));
      if (issue) invalidMedia.push({ sceneNumber: input.sceneNumber, type: input.role, reason: issue });
    } catch (error) {
      if (isMissingRenderObject(error)) {
        invalidMedia.push({ sceneNumber: input.sceneNumber, type: input.role, reason: "云端文件不存在" });
      } else {
        transientStorageError = true;
        console.error(`[render-jobs] Unable to verify scene ${input.sceneNumber} ${input.role}:`, error);
      }
    }
  }));
  if (transientStorageError) {
    await updateRenderJob({ jobId: renderJob.id, status: "failed", progress: 0, error: "场景素材检查暂时失败。" });
    return NextResponse.json(
      { error: "暂时无法检查场景素材，请稍后重试，当前素材不会被修改。" },
      { status: 503 }
    );
  }
  if (invalidMedia.length > 0) {
    await updateRenderJob({ jobId: renderJob.id, status: "failed", progress: 0, error: "场景云端素材已经失效。" });
    const scenes = Array.from(new Set(invalidMedia.map((item) => item.sceneNumber))).sort((left, right) => left - right);
    return NextResponse.json({
      error: `场景 ${scenes.join("、")} 的云端素材已失效，请重新生成这些场景的画面或配音后再导出。`,
      invalidMedia
    }, { status: 409 });
  }
  const running = await updateRenderJob({ jobId: renderJob.id, status: "running", progress: 5 });
  if (!running) {
    await updateRenderJob({
      jobId: renderJob.id,
      status: "cancelled",
      progress: 0,
      error: "视频版本已经发生变化。"
    });
    return NextResponse.json(
      { error: "视频版本已经发生变化，请刷新后导出当前版本。" },
      { status: 409 }
    );
  }

  try {
    const origin = new URL(request.url).origin;
    await startSandboxRender({
      jobId: renderJob.id,
      project,
      assetBaseUrl: origin,
      callbackUrl: `${origin}/api/render-jobs/callback`
    });
    return NextResponse.json(
      { renderJob: running, reused: false },
      { status: 202 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "视频渲染失败。";
    console.error("[render-jobs] Unable to start render:", error);
    const failed = await updateRenderJob({ jobId: renderJob.id, status: "failed", progress: 0, error: message });
    return NextResponse.json({
      error: "视频合成任务启动失败，请稍后重试。",
      renderJob: publicRenderJob(failed)
    }, { status: 502 });
  }
}
