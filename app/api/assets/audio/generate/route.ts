import { NextResponse } from "next/server";
import { z } from "zod";
import { generateProjectVoices } from "@/lib/audio-assets";
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
  const updated = await generateProjectVoices(project, body.sceneNumbers);

  await persistGeneratedSceneAssets(updated.currentVersion.id, updated.currentVersion.scenes, {
    replaceAudio: true
  });

  const targets = body.sceneNumbers?.length
    ? updated.currentVersion.scenes.filter((scene) => body.sceneNumbers?.includes(scene.sceneNumber))
    : updated.currentVersion.scenes;
  const failed = targets.filter((scene) => !scene.assets.some((asset) => asset.type === "audio" && asset.url));

  if (failed.length > 0) {
    return NextResponse.json(
      { error: "部分场景配音生成失败，请检查中文语音服务配置后重试。", project: updated },
      { status: 502 }
    );
  }

  return NextResponse.json({ project: updated });
}
