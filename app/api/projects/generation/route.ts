import { NextResponse } from "next/server";
import { z } from "zod";
import { authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import {
  attachGenerationRequestProject,
  claimGenerationRequest,
  deleteFailedGenerationRequest,
  failGenerationRequest,
  generationRequestFingerprint,
  getGenerationRequest,
  getGenerationRequestBeforeExpiry,
  listCompletedPendingGenerationRequests,
  listIncompleteGenerationRequests
} from "@/lib/generation-requests";
import {
  reconcileCompletedGenerationRequest,
  reconcileCompletedGenerationRequests,
  recoverStalledGenerationRequest,
  recoverStalledGenerationRequests
} from "@/lib/generation-reconciliation";
import {
  enqueueProjectGenerationWatchdog,
  enqueueProjectMediaScene
} from "@/lib/media-generation-queue";
import { getProjectSnapshot } from "@/lib/project-store";
import {
  InsufficientCreditsError,
  reserveAdditionalCredits,
  reserveCredits
} from "@/lib/billing/usage";
import { estimateBilling } from "@/lib/billing/estimate";
import { sceneRequiresPremiumImage } from "@/lib/image-continuity";
import { sceneHasAudioAsset, sceneHasVisualAsset } from "@/lib/generation-resume";

const requestIdSchema = z.string().uuid();
const retryRequestSchema = z.object({
  failedRequestId: z.string().uuid(),
  retryRequestId: z.string().uuid()
}).refine((value) => value.failedRequestId !== value.retryRequestId, {
  message: "重试任务必须使用新的任务标识。"
});

function projectReservationKey(requestId: string) {
  return `project-generation:${requestId}`;
}

function retryEstimateItems(scenes: NonNullable<Awaited<ReturnType<typeof getProjectSnapshot>>>["project"]["currentVersion"]["scenes"]) {
  const missingVisuals = scenes.filter((scene) => !sceneHasVisualAsset(scene));
  const missingNarrations = scenes.filter((scene) => !sceneHasAudioAsset(scene));
  return [
    ...(missingVisuals.length > 0
      ? [{ resourceType: "image_standard" as const, quantity: missingVisuals.length }]
      : []),
    ...(missingNarrations.length > 0
      ? [{
          resourceType: "speech" as const,
          quantity: missingNarrations.reduce(
            (sum, scene) => sum + Math.max(5, Math.ceil(scene.durationSeconds)),
            0
          )
        }]
      : [])
  ];
}

export async function GET(request: Request) {
  let user;
  try {
    user = await requireCurrentUser();
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    throw error;
  }
  const requestId = new URL(request.url).searchParams.get("requestId");
  if (!requestId) {
    const candidates = await listCompletedPendingGenerationRequests(user.id);
    await reconcileCompletedGenerationRequests(candidates, user.id);
    const incomplete = await listIncompleteGenerationRequests(user.id);
    return NextResponse.json({
      generationRequests: await recoverStalledGenerationRequests(incomplete, user.id)
    });
  }
  const parsed = requestIdSchema.safeParse(requestId);
  if (!parsed.success) {
    return NextResponse.json({ error: "生成任务标识无效。" }, { status: 400 });
  }
  const beforeExpiry = await getGenerationRequestBeforeExpiry(parsed.data, user.id);
  const reconciled = beforeExpiry
    ? await reconcileCompletedGenerationRequest(beforeExpiry, user.id)
    : undefined;
  const recovered = reconciled
    ? await recoverStalledGenerationRequest(reconciled, user.id)
    : undefined;
  const generation = recovered?.status === "pending"
    ? await getGenerationRequest(parsed.data, user.id) ?? recovered
    : recovered ?? await getGenerationRequest(parsed.data, user.id);
  if (!generation) {
    return NextResponse.json({ error: "没有找到生成任务。" }, { status: 404 });
  }
  if (generation.status === "ready" && generation.projectId) {
    const snapshot = await getProjectSnapshot(generation.projectId, user.id);
    if (!snapshot) {
      return NextResponse.json({ error: "生成任务已经完成，但项目读取失败。" }, { status: 502 });
    }
    return NextResponse.json({
      status: "ready",
      project: snapshot.project,
      messages: snapshot.messages,
      engine: generation.engine === "heuristic" ? "heuristic" : "ai",
      recovered: true
    });
  }
  if (generation.status === "failed") {
    return NextResponse.json({
      status: "failed",
      error: generation.error || "视频脚本和分镜生成没有完成，请重试。"
    });
  }
  if (generation.projectId) {
    const snapshot = await getProjectSnapshot(generation.projectId, user.id);
    const scenes = snapshot?.project.currentVersion.scenes ?? [];
    return NextResponse.json({
      status: "pending",
      phase: "media",
      projectId: generation.projectId,
      progress: {
        scenes: scenes.length,
        visuals: scenes.filter(sceneHasVisualAsset).length,
        narrations: scenes.filter((scene) => scene.assets.some((asset) => asset.type === "audio" && asset.url)).length
      }
    }, { status: 202 });
  }
  return NextResponse.json({ status: "pending" }, { status: 202 });
}

export async function DELETE(request: Request) {
  let user;
  try {
    user = await requireCurrentUser();
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    throw error;
  }
  const parsed = requestIdSchema.safeParse(new URL(request.url).searchParams.get("requestId"));
  if (!parsed.success) {
    return NextResponse.json({ error: "生成任务标识无效。" }, { status: 400 });
  }
  const deleted = await deleteFailedGenerationRequest(parsed.data, user.id);
  if (!deleted) {
    return NextResponse.json({ error: "只能删除属于你的失败任务。" }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}

export async function POST(request: Request) {
  let user;
  try {
    user = await requireCurrentUser();
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    throw error;
  }
  const parsed = retryRequestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "失败任务重试请求无效。" }, { status: 400 });
  }
  const { failedRequestId, retryRequestId } = parsed.data;
  const failed = await getGenerationRequestBeforeExpiry(failedRequestId, user.id);
  if (!failed || failed.status !== "failed" || !failed.projectId) {
    return NextResponse.json({ error: "只能重试属于你的、已经失败且保留了分镜的任务。" }, { status: 409 });
  }
  const snapshot = await getProjectSnapshot(failed.projectId, user.id);
  if (!snapshot) {
    return NextResponse.json({ error: "失败任务对应的项目已经不存在。" }, { status: 404 });
  }
  const scenes = snapshot.project.currentVersion.scenes;
  const firstIncomplete = scenes
    .filter((scene) => !sceneHasVisualAsset(scene) || !sceneHasAudioAsset(scene))
    .sort((left, right) => left.sceneNumber - right.sceneNumber)[0];
  if (!firstIncomplete) {
    await deleteFailedGenerationRequest(failedRequestId, user.id).catch((error) => {
      console.warn(`[generation-retry] Completed project ${snapshot.project.id} still has an old failure notice:`, error);
    });
    return NextResponse.json({
      status: "ready",
      project: snapshot.project,
      messages: snapshot.messages,
      engine: failed.engine === "heuristic" ? "heuristic" : "ai"
    });
  }

  const prompt = failed.prompt?.trim() || `补齐“${snapshot.project.title}”的缺失场景素材`;
  const claim = await claimGenerationRequest({
    id: retryRequestId,
    userId: user.id,
    prompt,
    options: failed.options,
    fingerprint: generationRequestFingerprint(prompt, failed.options)
  });
  if (claim.conflict) {
    return NextResponse.json({ error: "重试任务标识与当前项目不匹配，请重新操作。" }, { status: 409 });
  }
  if (!claim.claimed) {
    if (claim.record?.status === "pending") {
      return NextResponse.json({ status: "pending", requestId: retryRequestId }, { status: 202 });
    }
    if (claim.record?.status === "ready") {
      return NextResponse.json({
        status: "ready",
        project: snapshot.project,
        messages: snapshot.messages,
        engine: claim.record.engine === "heuristic" ? "heuristic" : "ai"
      });
    }
    return NextResponse.json({ error: claim.record?.error || "这次后台恢复没有完成，请重新操作。" }, { status: 409 });
  }

  const reservationKey = projectReservationKey(retryRequestId);
  const estimateItems = retryEstimateItems(scenes);
  try {
    const reservation = await reserveCredits({
      userId: user.id,
      reservationKey,
      items: estimateItems,
      metadata: {
        retryOfRequestId: failedRequestId,
        projectId: snapshot.project.id,
        versionId: snapshot.project.currentVersion.id,
        missingSceneNumbers: scenes
          .filter((scene) => !sceneHasVisualAsset(scene) || !sceneHasAudioAsset(scene))
          .map((scene) => scene.sceneNumber)
      },
      expiresInMinutes: 180
    });
    const standardImage = estimateBilling([{ resourceType: "image_standard", quantity: 1 }]);
    const premiumImage = estimateBilling([{ resourceType: "image_premium", quantity: 1 }]);
    for (const scene of scenes.filter((scene) => !sceneHasVisualAsset(scene) && sceneRequiresPremiumImage(scene))) {
      await reserveAdditionalCredits({
        userId: user.id,
        reservationKey,
        adjustmentKey: `${retryRequestId}:scene:${scene.sceneNumber}:premium-upgrade`,
        credits: premiumImage.maximumCredits - standardImage.maximumCredits,
        estimatedCostUsd: premiumImage.estimatedProviderCostUsd - standardImage.estimatedProviderCostUsd,
        metadata: { sceneNumber: scene.sceneNumber, automaticPremiumUpgrade: true, retryOfRequestId: failedRequestId }
      });
    }
    await attachGenerationRequestProject({
      id: retryRequestId,
      projectId: snapshot.project.id,
      engine: failed.engine ?? "ai"
    });
    await enqueueProjectGenerationWatchdog({
      operation: "watchdog",
      requestId: retryRequestId,
      userId: user.id,
      billingReservationKey: reservationKey
    });
    await enqueueProjectMediaScene({
      requestId: retryRequestId,
      userId: user.id,
      projectId: snapshot.project.id,
      versionId: snapshot.project.currentVersion.id,
      sceneNumber: firstIncomplete.sceneNumber,
      engine: failed.engine ?? "ai",
      billingReservationKey: reservationKey,
      options: failed.options,
      recoveryPass: 0,
      resumeAttempt: 0,
      startedAt: Date.now()
    });
    await deleteFailedGenerationRequest(failedRequestId, user.id).catch((error) => {
      console.warn(`[generation-retry] Retry ${retryRequestId} started, but the old failure notice could not be removed:`, error);
    });
    return NextResponse.json({
      status: "pending",
      requestId: retryRequestId,
      projectId: snapshot.project.id,
      billingEstimate: reservation.estimate
    }, { status: 202 });
  } catch (error) {
    await failGenerationRequest({
      id: retryRequestId,
      userId: user.id,
      error: error instanceof Error ? error.message : "后台恢复任务启动失败。",
      billingReservationKey: reservationKey,
      refundReason: "project_media_retry_start_failed",
      metadata: { retryOfRequestId: failedRequestId, projectId: snapshot.project.id }
    }).catch(() => undefined);
    if (error instanceof InsufficientCreditsError) {
      return NextResponse.json({
        error: error.message,
        code: "INSUFFICIENT_CREDITS",
        availableCredits: error.availableCredits,
        requiredCredits: error.requiredCredits
      }, { status: 402 });
    }
    console.error(`[generation-retry] Unable to enqueue retry ${retryRequestId}:`, error);
    return NextResponse.json({ error: "后台恢复任务启动失败，Credits 已自动释放，请稍后重试。" }, { status: 502 });
  }
}
