import { NextResponse } from "next/server";
import { z } from "zod";
import { authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { generateProjectSceneImages } from "@/lib/image-assets";
import { mediaGenerationFailureMessage, mediaGenerationProgress } from "@/lib/media-generation-result";
import { loadCurrentProjectForEdit, persistGeneratedSceneAssets } from "@/lib/project-mutations";

const requestSchema = z.object({
  projectId: z.string().min(1).max(200),
  versionId: z.string().min(1).max(200),
  sceneNumbers: z.array(z.number().int().positive()).optional(),
  quality: z.enum(["standard", "premium"]).default("standard")
});

export const maxDuration = 120;

export async function POST(request: Request) {
  let user;
  try {
    user = await requireCurrentUser();
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    throw error;
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return NextResponse.json({ error: "画面生成请求格式无效。" }, { status: 400 });
  }
  const body = parsed.data;
  const project = await loadCurrentProjectForEdit(body.projectId, body.versionId, user.id);
  if (!project) {
    return NextResponse.json({ error: "视频版本已经发生变化，请刷新后重试。" }, { status: 409 });
  }
  const validScenes = new Set(project.currentVersion.scenes.map((scene) => scene.sceneNumber));
  if (body.sceneNumbers?.some((sceneNumber) => !validScenes.has(sceneNumber))) {
    return NextResponse.json({ error: "请求包含当前版本中不存在的场景。" }, { status: 409 });
  }
  const previousImageKeys = new Map(
    project.currentVersion.scenes.map((scene) => [
      scene.sceneNumber,
      scene.assets.find((asset) => asset.type === "image" && asset.url)?.r2Key
    ])
  );
  const updated = await generateProjectSceneImages(project, {
    replaceExistingImages: true,
    sceneNumbers: body.sceneNumbers,
    quality: body.quality
  });

  const targetScenes = body.sceneNumbers?.length
    ? updated.currentVersion.scenes.filter((scene) => body.sceneNumbers?.includes(scene.sceneNumber))
    : updated.currentVersion.scenes;
  const failedTargets = targetScenes.filter(
    (scene) => {
      const nextImage = scene.assets.find((asset) => asset.type === "image" && asset.url);
      return !nextImage || nextImage.r2Key === previousImageKeys.get(scene.sceneNumber);
    }
  );

  await persistGeneratedSceneAssets(updated.currentVersion.id, updated.currentVersion.scenes, {
    replaceImages: true,
    sceneNumbers: body.sceneNumbers
  });
  const progress = mediaGenerationProgress(
    targetScenes.map((scene) => scene.sceneNumber),
    failedTargets.map((scene) => scene.sceneNumber)
  );

  if (failedTargets.length > 0) {
    const messages = {
      missing_key: "图片服务尚未配置，请先设置有效的图片 API Key。",
      invalid_key: "图片服务凭证无效，请在 Vercel 中更新服务配置。",
      storage_failed: "图片已经生成，但写入云端存储失败，请检查 R2 配置。",
      generation_failed: "场景画面生成失败，请稍后重试。"
    } as const;
    const code = updated.currentVersion.assetErrorCode || "generation_failed";
    return NextResponse.json(
      {
        error: mediaGenerationFailureMessage("画面", progress, messages[code]),
        code,
        project: updated,
        ...progress
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ project: updated, ...progress });
}
