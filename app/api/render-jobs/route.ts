import { after, NextResponse } from "next/server";
import { z } from "zod";
import { loadCurrentProjectForEdit } from "@/lib/project-mutations";
import { publicRenderError, renderSandboxName } from "@/lib/render-lifecycle";
import { acquireRenderJob, cancelRenderJob, getRenderJob, listRenderJobs, updateRenderJob } from "@/lib/render-jobs";
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
  const missingVisuals = project.currentVersion.scenes
    .filter((scene) => !scene.assets.some((asset) => asset.type === "image" || asset.type === "clip"))
    .map((scene) => scene.sceneNumber);
  const missingAudio = project.currentVersion.scenes
    .filter((scene) => !scene.assets.some((asset) => asset.type === "audio"))
    .map((scene) => scene.sceneNumber);
  if (project.currentVersion.scenes.length === 0 || missingVisuals.length > 0 || missingAudio.length > 0) {
    const details = [
      missingVisuals.length > 0 ? `缺少画面的场景：${missingVisuals.join("、")}` : "",
      missingAudio.length > 0 ? `缺少配音的场景：${missingAudio.join("、")}` : ""
    ].filter(Boolean).join("；");
    return NextResponse.json(
      { error: details ? `视频素材尚未完整。${details}。` : "视频还没有可渲染的场景。" },
      { status: 409 }
    );
  }
  const acquired = await acquireRenderJob(body.projectId, body.versionId);
  if (!acquired) {
    return NextResponse.json(
      { error: "视频版本已经发生变化，请刷新后导出当前版本。" },
      { status: 409 }
    );
  }
  if (acquired.reused) {
    return NextResponse.json(
      { renderJob: publicRenderJob(acquired.renderJob), reused: true },
      { status: acquired.renderJob.status === "ready" ? 200 : 202 }
    );
  }
  const renderJob = acquired.renderJob;
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
