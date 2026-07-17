import { NextResponse } from "next/server";
import { z } from "zod";
import { mediaGenerationFailureMessage, mediaGenerationProgress } from "@/lib/media-generation-result";
import { loadCurrentProjectForEdit, persistGeneratedSceneAssets } from "@/lib/project-mutations";
import { generateProjectSceneClips } from "@/lib/video-assets";

const requestSchema = z.object({
  projectId: z.string().min(1).max(200),
  versionId: z.string().min(1).max(200),
  sceneNumbers: z.array(z.number().int().positive()).length(1),
  quality: z.enum(["standard", "premium"]).default("standard")
});

export const maxDuration = 300;

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return NextResponse.json({ error: "动态镜头请求格式无效。" }, { status: 400 });
  }
  const body = parsed.data;
  const project = await loadCurrentProjectForEdit(body.projectId, body.versionId);
  if (!project) {
    return NextResponse.json({ error: "视频版本已经发生变化，请刷新后重试。" }, { status: 409 });
  }
  const targetScenes = project.currentVersion.scenes.filter((scene) => body.sceneNumbers.includes(scene.sceneNumber));
  if (targetScenes.length !== body.sceneNumbers.length) {
    return NextResponse.json({ error: "请求包含当前版本中不存在的场景。" }, { status: 409 });
  }
  const scenesWithoutImages = targetScenes
    .filter((scene) => !scene.assets.some((asset) => asset.type === "image" && asset.url))
    .map((scene) => scene.sceneNumber);
  if (scenesWithoutImages.length > 0) {
    return NextResponse.json({
      error: `请先为场景 ${scenesWithoutImages.join("、")} 生成关键帧，再生成动态镜头。`
    }, { status: 409 });
  }

  const previousClipKeys = new Map(targetScenes.map((scene) => [
    scene.sceneNumber,
    scene.assets.find((asset) => asset.type === "clip" && asset.url)?.r2Key
  ]));
  const result = await generateProjectSceneClips(project, {
    assetBaseUrl: new URL(request.url).origin,
    sceneNumbers: body.sceneNumbers,
    quality: body.quality
  });
  await persistGeneratedSceneAssets(result.project.currentVersion.id, result.project.currentVersion.scenes, {
    replaceClips: true,
    sceneNumbers: body.sceneNumbers
  });
  const failed = result.project.currentVersion.scenes.filter((scene) => {
    if (!body.sceneNumbers.includes(scene.sceneNumber)) return false;
    const clip = scene.assets.find((asset) => asset.type === "clip" && asset.url);
    return !clip || clip.r2Key === previousClipKeys.get(scene.sceneNumber);
  });
  const progress = mediaGenerationProgress(
    body.sceneNumbers,
    failed.map((scene) => scene.sceneNumber)
  );
  if (failed.length > 0) {
    return NextResponse.json({
      error: mediaGenerationFailureMessage(
        "动态镜头",
        progress,
        "请确认账户已开通视频生成能力，或稍后重试。"
      ),
      project: result.project,
      ...progress
    }, { status: 502 });
  }
  return NextResponse.json({ project: result.project, ...progress });
}
