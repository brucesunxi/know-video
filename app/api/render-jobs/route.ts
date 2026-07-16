import { NextResponse } from "next/server";
import { z } from "zod";
import { loadProjectForRender } from "@/lib/project-mutations";
import { createRenderJob, findReusableRenderJob, getRenderJob, updateRenderJob } from "@/lib/render-jobs";
import { startSandboxRender } from "@/lib/vercel-renderer";

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
  const project = await loadProjectForRender(body.projectId, body.versionId);
  if (!project) return NextResponse.json({ error: "没有找到需要渲染的视频版本。" }, { status: 404 });
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
  const reusable = await findReusableRenderJob(body.projectId, body.versionId);
  if (reusable) {
    return NextResponse.json(
      { renderJob: reusable, reused: true },
      { status: reusable.status === "ready" ? 200 : 202 }
    );
  }
  const renderJob = await createRenderJob(body.projectId, body.versionId);
  await updateRenderJob({ jobId: renderJob.id, status: "running", progress: 5 });

  try {
    const origin = new URL(request.url).origin;
    await startSandboxRender({
      jobId: renderJob.id,
      project,
      assetBaseUrl: origin,
      callbackUrl: `${origin}/api/render-jobs/callback`
    });
    return NextResponse.json(
      { renderJob: { ...renderJob, status: "running", progress: 5 }, reused: false },
      { status: 202 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "视频渲染失败。";
    const failed = await updateRenderJob({ jobId: renderJob.id, status: "failed", progress: 0, error: message });
    return NextResponse.json({ error: message, renderJob: failed }, { status: 502 });
  }
}
