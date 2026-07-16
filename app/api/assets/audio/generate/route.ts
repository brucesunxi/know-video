import { NextResponse } from "next/server";
import { z } from "zod";
import { generateProjectVoices } from "@/lib/audio-assets";
import { loadCurrentProjectForEdit, persistGeneratedSceneAssets } from "@/lib/project-mutations";
import { isNarrationVoice } from "@/lib/voice-profiles";

const requestSchema = z.object({
  projectId: z.string().min(1).max(200),
  versionId: z.string().min(1).max(200),
  sceneNumbers: z.array(z.number().int().positive()).optional(),
  narrationVoice: z.string().refine(isNarrationVoice).optional()
});

export const maxDuration = 120;

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return NextResponse.json({ error: "配音请求格式无效。" }, { status: 400 });
  }
  const body = parsed.data;
  const project = await loadCurrentProjectForEdit(body.projectId, body.versionId);
  if (!project) {
    return NextResponse.json({ error: "视频版本已经发生变化，请刷新后重试。" }, { status: 409 });
  }
  const validScenes = new Set(project.currentVersion.scenes.map((scene) => scene.sceneNumber));
  if (body.sceneNumbers?.some((sceneNumber) => !validScenes.has(sceneNumber))) {
    return NextResponse.json({ error: "请求包含当前版本中不存在的场景。" }, { status: 409 });
  }
  const previousAudioKeys = new Map(project.currentVersion.scenes.map((scene) => [
    scene.sceneNumber,
    scene.assets.find((asset) => asset.type === "audio" && asset.url)?.r2Key
  ]));
  if (body.narrationVoice && !body.sceneNumbers?.length) {
    return NextResponse.json({ error: "选择音色时必须指定要更新的场景。" }, { status: 400 });
  }
  const updated = await generateProjectVoices(project, body.sceneNumbers, body.narrationVoice);

  await persistGeneratedSceneAssets(updated.currentVersion.id, updated.currentVersion.scenes, {
    replaceAudio: true,
    sceneNumbers: body.sceneNumbers,
    updateStyles: Boolean(body.narrationVoice)
  });

  const targets = body.sceneNumbers?.length
    ? updated.currentVersion.scenes.filter((scene) => body.sceneNumbers?.includes(scene.sceneNumber))
    : updated.currentVersion.scenes;
  const failed = targets.filter((scene) => {
    const nextAudio = scene.assets.find((asset) => asset.type === "audio" && asset.url);
    return !nextAudio || nextAudio.r2Key === previousAudioKeys.get(scene.sceneNumber);
  });

  if (failed.length > 0) {
    return NextResponse.json(
      { error: "部分场景配音未完成。请缩短过长旁白后重试；如果所有旁白都很短，请检查语音服务配置。", project: updated },
      { status: 502 }
    );
  }

  return NextResponse.json({ project: updated });
}
