import { NextResponse } from "next/server";
import { z } from "zod";
import { authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { mediaGenerationFailureMessage, mediaGenerationProgress } from "@/lib/media-generation-result";
import { loadCurrentProjectForEdit, persistGeneratedSceneAssets } from "@/lib/project-mutations";
import { generateProjectStockClips, hasFreeStockVideoProvider } from "@/lib/stock-video-assets";

const requestSchema = z.object({
  projectId: z.string().min(1).max(200),
  versionId: z.string().min(1).max(200),
  sceneNumbers: z.array(z.number().int().positive()).min(1).max(8)
});

export const maxDuration = 300;

export async function POST(request: Request) {
  let user;
  try {
    user = await requireCurrentUser();
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    throw error;
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: "免费动态素材请求格式无效。" }, { status: 400 });
  if (!hasFreeStockVideoProvider()) {
    return NextResponse.json({
      error: "免费动态素材尚未配置。请配置 PEXELS_API_KEY 或 PIXABAY_API_KEY；系统不会改用付费视频模型。",
      errorCode: "FREE_STOCK_NOT_CONFIGURED"
    }, { status: 503 });
  }

  const body = parsed.data;
  const project = await loadCurrentProjectForEdit(body.projectId, body.versionId, user.id);
  if (!project) return NextResponse.json({ error: "视频版本已经发生变化，请刷新后重试。" }, { status: 409 });
  const validNumbers = new Set(project.currentVersion.scenes.map((scene) => scene.sceneNumber));
  if (body.sceneNumbers.some((sceneNumber) => !validNumbers.has(sceneNumber))) {
    return NextResponse.json({ error: "请求包含当前版本中不存在的场景。" }, { status: 409 });
  }

  const previousClipKeys = new Map(project.currentVersion.scenes.map((scene) => [
    scene.sceneNumber,
    scene.assets.find((asset) => asset.type === "clip" && asset.url)?.r2Key
  ]));
  const result = await generateProjectStockClips(project, body.sceneNumbers);
  await persistGeneratedSceneAssets(result.project.currentVersion.id, result.project.currentVersion.scenes, {
    replaceClips: true,
    sceneNumbers: body.sceneNumbers
  });
  const failedSceneNumbers = result.project.currentVersion.scenes
    .filter((scene) => body.sceneNumbers.includes(scene.sceneNumber))
    .filter((scene) => {
      const clip = scene.assets.find((asset) => asset.type === "clip" && asset.url);
      return !clip || clip.r2Key === previousClipKeys.get(scene.sceneNumber);
    })
    .map((scene) => scene.sceneNumber);
  const progress = mediaGenerationProgress(body.sceneNumbers, failedSceneNumbers);
  if (failedSceneNumbers.length > 0) {
    return NextResponse.json({
      error: mediaGenerationFailureMessage("免费动态素材", progress, "未匹配到足够相关的可用视频，未完成场景会继续使用简单运镜。"),
      project: result.project,
      ...progress
    }, { status: progress.completedSceneNumbers.length > 0 ? 207 : 502 });
  }
  return NextResponse.json({ project: result.project, costUsd: 0, ...progress });
}
