import { NextResponse } from "next/server";
import { z } from "zod";
import { generateProjectSceneImages } from "@/lib/image-assets";
import { persistGeneratedSceneAssets } from "@/lib/project-mutations";
import type { Project } from "@/lib/types";

const requestSchema = z.object({
  project: z.unknown(),
  sceneNumbers: z.array(z.number().int().positive()).optional()
});

export const maxDuration = 120;

export async function POST(request: Request) {
  const body = requestSchema.parse(await request.json());
  const project = body.project as Project;
  const updated = await generateProjectSceneImages(project, {
    replaceExistingImages: true,
    sceneNumbers: body.sceneNumbers
  });

  await persistGeneratedSceneAssets(updated.currentVersion.id, updated.currentVersion.scenes);

  const targetScenes = body.sceneNumbers?.length
    ? updated.currentVersion.scenes.filter((scene) => body.sceneNumbers?.includes(scene.sceneNumber))
    : updated.currentVersion.scenes;
  const failedTargets = targetScenes.filter(
    (scene) => !scene.assets.some((asset) => asset.type === "image" && asset.url)
  );

  if (failedTargets.length > 0) {
    const messages = {
      missing_key: "图片服务尚未配置，请先设置有效的图片 API Key。",
      invalid_key: "图片服务凭证无效，请在 Vercel 中更新 OPENAI_API_KEY。",
      storage_failed: "图片已经生成，但写入云端存储失败，请检查 R2 配置。",
      generation_failed: "场景画面生成失败，请稍后重试。"
    } as const;
    const code = updated.currentVersion.assetErrorCode || "generation_failed";
    return NextResponse.json(
      { error: messages[code], code, project: updated },
      { status: 502 }
    );
  }

  return NextResponse.json({ project: updated });
}
