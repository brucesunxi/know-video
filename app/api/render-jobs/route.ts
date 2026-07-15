import { NextResponse } from "next/server";
import { z } from "zod";
import { getOptionalEnv } from "@/lib/env";
import { loadProjectForRender } from "@/lib/project-mutations";
import { createRenderJob, getRenderJob, updateRenderJob } from "@/lib/render-jobs";

const requestSchema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid()
});

export const maxDuration = 300;

export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("id");
  if (!jobId) return NextResponse.json({ error: "缺少渲染任务 ID。" }, { status: 400 });
  const renderJob = await getRenderJob(jobId);
  return renderJob
    ? NextResponse.json({ renderJob })
    : NextResponse.json({ error: "没有找到渲染任务。" }, { status: 404 });
}
export async function POST(request: Request) {
  const body = requestSchema.parse(await request.json());
  const workerUrl = getOptionalEnv("RENDER_WORKER_URL");
  const workerSecret = getOptionalEnv("WORKER_SHARED_SECRET");
  if (!workerUrl || !workerSecret) {
    return NextResponse.json(
      { error: "MP4 渲染服务尚未部署。预览可以播放，但服务器导出需要先连接渲染 Worker。", code: "worker_not_configured" },
      { status: 503 }
    );
  }

  const project = await loadProjectForRender(body.projectId, body.versionId);
  if (!project) return NextResponse.json({ error: "没有找到需要渲染的视频版本。" }, { status: 404 });
  const renderJob = await createRenderJob(body.projectId, body.versionId);
  await updateRenderJob({ jobId: renderJob.id, status: "running", progress: 5 });

  try {
    const origin = new URL(request.url).origin;
    const workerResponse = await fetch(`${workerUrl.replace(/\/$/, "")}/render`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${workerSecret}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        jobId: renderJob.id,
        project,
        assetBaseUrl: origin,
        callbackUrl: `${origin}/api/render-jobs/callback`
      }),
      signal: AbortSignal.timeout(290_000)
    });
    const result = await workerResponse.json().catch(() => ({})) as { outputR2Key?: string; error?: string };
    if (!workerResponse.ok || !result.outputR2Key) {
      throw new Error(result.error || `渲染服务返回 ${workerResponse.status}`);
    }
    const completed = await updateRenderJob({
      jobId: renderJob.id,
      status: "ready",
      progress: 100,
      outputR2Key: result.outputR2Key
    });
    return NextResponse.json({ renderJob: completed ?? { ...renderJob, status: "ready", progress: 100 } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "视频渲染失败。";
    const failed = await updateRenderJob({ jobId: renderJob.id, status: "failed", progress: 0, error: message });
    return NextResponse.json({ error: message, renderJob: failed }, { status: 502 });
  }
}
