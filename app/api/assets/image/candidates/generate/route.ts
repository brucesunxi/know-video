import { NextResponse } from "next/server";
import { z } from "zod";
import { authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { CandidateImageError, generateSceneImageCandidate } from "@/lib/image-candidates";
import { loadCurrentProjectForEdit } from "@/lib/project-mutations";
import { billingIdempotencyKey, recordUsageEvent } from "@/lib/billing/usage";

const schema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid(),
  sceneNumber: z.number().int().positive(),
  instruction: z.string().trim().max(600).optional().default(""),
  quality: z.enum(["standard", "premium"]).default("standard"),
  billingRequestId: z.string().uuid().optional()
});

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    const body = schema.parse(await request.json());
    const project = await loadCurrentProjectForEdit(body.projectId, body.versionId, user.id);
    if (!project) return NextResponse.json({ error: "视频版本已经发生变化，请刷新后重试。" }, { status: 409 });
    const result = await generateSceneImageCandidate(project, {
      quality: body.quality,
      sceneNumber: body.sceneNumber,
      instruction: body.instruction
    });
    const resourceType = body.quality === "premium" ? "image_premium" : "image_standard";
    await recordUsageEvent({
      userId: user.id,
      projectId: body.projectId,
      versionId: body.versionId,
      resourceType,
      quantity: 1,
      idempotencyKey: body.billingRequestId
        ? `${resourceType}:${body.billingRequestId}`
        : billingIdempotencyKey(resourceType, [body.projectId, body.versionId, "candidate", result.candidate.r2Key]),
      status: "settled",
      metadata: {
        sceneNumber: body.sceneNumber,
        quality: body.quality,
        candidate: true,
        assetKey: result.candidate.r2Key
      }
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    if (error instanceof z.ZodError) return NextResponse.json({ error: "候选画面请求格式无效。" }, { status: 400 });
    if (error instanceof CandidateImageError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[image-candidates] Unable to generate candidate:", error);
    return NextResponse.json({ error: "候选画面生成失败，请稍后重试。" }, { status: 502 });
  }
}
