import { NextResponse } from "next/server";
import { z } from "zod";
import { authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { generateProjectVoices } from "@/lib/audio-assets";
import { mediaGenerationFailureMessage, mediaGenerationProgress } from "@/lib/media-generation-result";
import { loadCurrentProjectForEdit, persistGeneratedSceneAssets } from "@/lib/project-mutations";
import type { Scene } from "@/lib/types";
import { isNarrationVoice } from "@/lib/voice-profiles";
import { billingIdempotencyKey, recordUsageEvent } from "@/lib/billing/usage";
import { InsufficientCreditsError, releaseCreditReservation, reserveAdditionalCredits, reserveCredits } from "@/lib/billing/usage";
import { estimateBilling } from "@/lib/billing/estimate";

const requestSchema = z.object({
  projectId: z.string().min(1).max(200),
  versionId: z.string().min(1).max(200),
  sceneNumbers: z.array(z.number().int().positive()).optional(),
  narrationVoice: z.string().refine(isNarrationVoice).optional(),
  billingRequestId: z.string().uuid().optional()
});

export const maxDuration = 300;

function audioFailedScenes(
  scenes: Scene[],
  sceneNumbers: number[],
  previousAudioKeys: Map<number, string | undefined>
) {
  const targets = scenes.filter((scene) => sceneNumbers.includes(scene.sceneNumber));
  return targets.filter((scene) => {
    const nextAudio = scene.assets.find((asset) => asset.type === "audio" && asset.url);
    return !nextAudio || nextAudio.r2Key === previousAudioKeys.get(scene.sceneNumber);
  });
}

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
    return NextResponse.json({ error: "配音请求格式无效。" }, { status: 400 });
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
  const previousAudioKeys = new Map(project.currentVersion.scenes.map((scene) => [
    scene.sceneNumber,
    scene.assets.find((asset) => asset.type === "audio" && asset.url)?.r2Key
  ]));
  if (body.narrationVoice && !body.sceneNumbers?.length) {
    return NextResponse.json({ error: "选择音色时必须指定要更新的场景。" }, { status: 400 });
  }
  const requestedSceneNumbers = body.sceneNumbers?.length
    ? body.sceneNumbers
    : project.currentVersion.scenes.map((scene) => scene.sceneNumber);
  const estimatedAudioSeconds = Math.max(1, requestedSceneNumbers.reduce((sum, sceneNumber) => {
    const scene = project.currentVersion.scenes.find((item) => item.sceneNumber === sceneNumber);
    return sum + Math.max(5, Math.ceil((scene?.durationSeconds ?? 0) * 1.2));
  }, 0));
  const billingOperationId = body.billingRequestId
    ?? billingIdempotencyKey("speech", [body.projectId, body.versionId, "generate", ...requestedSceneNumbers]);
  const reservationKey = `asset-audio:${billingOperationId}`;
  const initialEstimate = estimateBilling([{ resourceType: "speech", quantity: estimatedAudioSeconds }]);
  try {
    await reserveCredits({
      userId: user.id,
      reservationKey,
      items: [{ resourceType: "speech", quantity: estimatedAudioSeconds }],
      metadata: { projectId: body.projectId, versionId: body.versionId, requestedSceneNumbers }
    });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: error.message, code: "INSUFFICIENT_CREDITS", availableCredits: error.availableCredits, requiredCredits: error.requiredCredits }, { status: 402 });
    }
    throw error;
  }
  try {
  let updated = await generateProjectVoices(project, body.sceneNumbers, body.narrationVoice);
  let failed = audioFailedScenes(updated.currentVersion.scenes, requestedSceneNumbers, previousAudioKeys);

  for (let retry = 0; retry < 2 && failed.length > 0; retry += 1) {
    const retrySceneNumbers = failed.map((scene) => scene.sceneNumber);
    console.warn(`[audio-assets] Retrying failed voice scenes (${retry + 1}/2): ${retrySceneNumbers.join(",")}.`);
    updated = await generateProjectVoices(updated, retrySceneNumbers, body.narrationVoice);
    failed = audioFailedScenes(updated.currentVersion.scenes, requestedSceneNumbers, previousAudioKeys);
  }

  await persistGeneratedSceneAssets(updated.currentVersion.id, updated.currentVersion.scenes, {
    replaceAudio: true,
    sceneNumbers: body.sceneNumbers,
    updateStyles: Boolean(body.narrationVoice),
    updateNarration: true
  });

  const progress = mediaGenerationProgress(
    requestedSceneNumbers,
    failed.map((scene) => scene.sceneNumber)
  );
  console.info(`[audio-assets] Voice generation completed ${progress.completedSceneNumbers.length}/${progress.requestedSceneNumbers.length}; failed scenes: ${progress.failedSceneNumbers.join(",") || "none"}.`);
  const completedScenes = updated.currentVersion.scenes.filter((scene) => progress.completedSceneNumbers.includes(scene.sceneNumber));
  const completedAudioSeconds = completedScenes.reduce((sum, scene) => {
    const audio = scene.assets.find((asset) => asset.type === "audio" && asset.url);
    const duration = Number(audio?.metadata?.actualDurationSeconds ?? scene.durationSeconds);
    return sum + (Number.isFinite(duration) && duration > 0 ? duration : scene.durationSeconds);
  }, 0);
  if (completedAudioSeconds > 0) {
    const completedSceneUsage = completedScenes.map((scene) => {
      const audio = scene.assets.find((asset) => asset.type === "audio" && asset.url);
      const duration = Number(audio?.metadata?.actualDurationSeconds ?? scene.durationSeconds);
      return {
        scene,
        audio,
        duration: Number.isFinite(duration) && duration > 0 ? duration : scene.durationSeconds
      };
    });
    const actualCredits = completedSceneUsage.reduce(
      (sum, usage) => sum + estimateBilling([{ resourceType: "speech", quantity: usage.duration }]).maximumCredits,
      0
    );
    const actualEstimate = estimateBilling([{ resourceType: "speech", quantity: Math.max(1, actualCredits) }]);
    if (actualEstimate.maximumCredits > initialEstimate.maximumCredits) {
      await reserveAdditionalCredits({
        userId: user.id,
        reservationKey,
        adjustmentKey: `${billingOperationId}:actual-duration`,
        credits: actualEstimate.maximumCredits - initialEstimate.maximumCredits,
        estimatedCostUsd: Math.max(0, actualEstimate.estimatedProviderCostUsd - initialEstimate.estimatedProviderCostUsd),
        metadata: { completedAudioSeconds }
      });
    }
    for (const usage of completedSceneUsage) {
      await recordUsageEvent({
        userId: user.id,
        projectId: body.projectId,
        versionId: body.versionId,
        reservationKey,
        resourceType: "speech",
        quantity: usage.duration,
        idempotencyKey: body.billingRequestId
          ? `speech:${body.billingRequestId}:scene:${usage.scene.sceneNumber}`
          : billingIdempotencyKey("speech", [body.projectId, body.versionId, usage.scene.sceneNumber, usage.audio?.r2Key]),
        status: "settled",
        metadata: {
          sceneNumber: usage.scene.sceneNumber,
          requestedSceneNumbers,
          failedSceneNumbers: progress.failedSceneNumbers,
          narrationVoice: body.narrationVoice,
          assetKey: usage.audio?.r2Key
        }
      });
    }
    await releaseCreditReservation({ userId: user.id, reservationKey, reason: "audio_batch_finished" });
  } else {
    await releaseCreditReservation({
      userId: user.id,
      reservationKey,
      reason: "audio_generation_failed",
      metadata: { requestedSceneNumbers, failedSceneNumbers: progress.failedSceneNumbers, narrationVoice: body.narrationVoice }
    });
  }

  if (failed.length > 0) {
    return NextResponse.json(
      {
        error: mediaGenerationFailureMessage(
          "配音",
          progress,
          "系统将只针对失败场景继续自动补齐，不会把未完成项目标记为可导出。"
        ),
        project: updated,
        ...progress
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ project: updated, ...progress });
  } catch (error) {
    await releaseCreditReservation({
      userId: user.id,
      reservationKey,
      reason: "audio_generation_exception",
      metadata: { requestedSceneNumbers, narrationVoice: body.narrationVoice }
    }).catch(() => undefined);
    throw error;
  }
}
