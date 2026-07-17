import { NextResponse } from "next/server";
import { z } from "zod";
import { CandidateImageError, generateSceneImageCandidate } from "@/lib/image-candidates";
import { loadCurrentProjectForEdit } from "@/lib/project-mutations";

const schema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid(),
  sceneNumber: z.number().int().positive(),
  instruction: z.string().trim().max(600).optional().default(""),
  quality: z.enum(["standard", "premium"]).default("standard")
});

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const project = await loadCurrentProjectForEdit(body.projectId, body.versionId);
    if (!project) return NextResponse.json({ error: "视频版本已经发生变化，请刷新后重试。" }, { status: 409 });
    const result = await generateSceneImageCandidate(project, {
      quality: body.quality,
      sceneNumber: body.sceneNumber,
      instruction: body.instruction
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "候选画面请求格式无效。" }, { status: 400 });
    if (error instanceof CandidateImageError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[image-candidates] Unable to generate candidate:", error);
    return NextResponse.json({ error: "候选画面生成失败，请稍后重试。" }, { status: 502 });
  }
}
