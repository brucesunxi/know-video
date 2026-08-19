import { NextResponse } from "next/server";
import { z } from "zod";
import { authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { CandidateImageError, generateSceneImageCandidate } from "@/lib/image-candidates";
import { loadCurrentProjectForEdit } from "@/lib/project-mutations";
import { InsufficientCreditsError, billingIdempotencyKey, recordUsageEvent, releaseCreditReservation, reserveCredits } from "@/lib/billing/usage";
import { sceneRequiresPremiumImage } from "@/lib/image-continuity";

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
  let activeReservation: { userId: string; reservationKey: string } | undefined;
  try {
    const user = await requireCurrentUser();
    const body = schema.parse(await request.json());
    const project = await loadCurrentProjectForEdit(body.projectId, body.versionId, user.id);
    if (!project) return NextResponse.json({ error: "视频版本已经发生变化，请刷新后重试。" }, { status: 409 });
    const scene = project.currentVersion.scenes.find((item) => item.sceneNumber === body.sceneNumber);
    if (!scene) return NextResponse.json({ error: "请求包含当前版本中不存在的场景。" }, { status: 409 });
    const effectiveQuality = body.quality === "premium" || sceneRequiresPremiumImage(scene) ? "premium" : "standard";
    const resourceType = effectiveQuality === "premium" ? "image_premium" : "image_standard";
    const billingOperationId = body.billingRequestId
      ?? billingIdempotencyKey(resourceType, [body.projectId, body.versionId, "candidate", body.sceneNumber, body.instruction]);
    activeReservation = { userId: user.id, reservationKey: `image-candidate:${billingOperationId}` };
    await reserveCredits({
      ...activeReservation,
      items: [{ resourceType, quantity: 1 }],
      metadata: { projectId: body.projectId, versionId: body.versionId, sceneNumber: body.sceneNumber, requestedQuality: body.quality, effectiveQuality }
    });
    const result = await generateSceneImageCandidate(project, {
      quality: effectiveQuality,
      sceneNumber: body.sceneNumber,
      instruction: body.instruction
    });
    await recordUsageEvent({
      userId: user.id,
      projectId: body.projectId,
      versionId: body.versionId,
      reservationKey: activeReservation.reservationKey,
      resourceType,
      quantity: 1,
      idempotencyKey: body.billingRequestId
        ? `${resourceType}:${body.billingRequestId}`
        : billingIdempotencyKey(resourceType, [body.projectId, body.versionId, "candidate", result.candidate.r2Key]),
      status: "settled",
      actualCostUsd: Number(result.candidate.metadata?.estimatedActualCostUsd) || undefined,
      actualModel: typeof result.candidate.metadata?.model === "string" ? result.candidate.metadata.model : undefined,
      actualProvider: String(result.candidate.metadata?.model ?? "").startsWith("gpt-") ? "openai" : "cloudflare",
      metadata: {
        sceneNumber: body.sceneNumber,
        requestedQuality: body.quality,
        effectiveQuality,
        automaticPremiumUpgrade: body.quality !== effectiveQuality,
        providerRequestCount: result.candidate.metadata?.providerRequestCount,
        validationRequestCount: result.candidate.metadata?.validationRequestCount,
        internalRetriesNotCharged: Math.max(0, Number(result.candidate.metadata?.providerRequestCount ?? 1) - 1),
        candidate: true,
        assetKey: result.candidate.r2Key
      }
    });
    await releaseCreditReservation({ ...activeReservation, reason: "image_candidate_finished" });
    return NextResponse.json(result);
  } catch (error) {
    if (activeReservation) {
      await releaseCreditReservation({ ...activeReservation, reason: "image_candidate_failed" }).catch(() => undefined);
    }
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    if (error instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: error.message, code: "INSUFFICIENT_CREDITS", availableCredits: error.availableCredits, requiredCredits: error.requiredCredits }, { status: 402 });
    }
    if (error instanceof z.ZodError) return NextResponse.json({ error: "候选画面请求格式无效。" }, { status: 400 });
    if (error instanceof CandidateImageError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[image-candidates] Unable to generate candidate:", error);
    return NextResponse.json({ error: "候选画面生成失败，请稍后重试。" }, { status: 502 });
  }
}
