import { NextResponse } from "next/server";
import { z } from "zod";
import { authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { generateProjectSceneImages } from "@/lib/image-assets";
import { mediaGenerationFailureMessage, mediaGenerationProgress } from "@/lib/media-generation-result";
import { loadCurrentProjectForEdit, loadProjectForRender, persistGeneratedSceneAssets } from "@/lib/project-mutations";
import type { Scene } from "@/lib/types";
import { billingIdempotencyKey, recordUsageEvent } from "@/lib/billing/usage";
import { InsufficientCreditsError, releaseCreditReservation, reserveCredits } from "@/lib/billing/usage";
import { sceneRequiresPremiumImage } from "@/lib/image-continuity";

const requestSchema = z.object({
  projectId: z.string().min(1).max(200),
  versionId: z.string().min(1).max(200),
  sceneNumbers: z.array(z.number().int().positive()).optional(),
  quality: z.enum(["standard", "premium"]).default("standard"),
  variantKey: z.string().min(1).max(200).optional(),
  billingRequestId: z.string().uuid().optional()
});

export const maxDuration = 300;
const MAX_SCENES_PER_IMAGE_REQUEST = 1;

function imageFailedScenes(
  scenes: Scene[],
  sceneNumbers: number[],
  previousImageKeys: Map<number, string | undefined>
) {
  return scenes
    .filter((scene) => sceneNumbers.includes(scene.sceneNumber))
    .filter((scene) => {
      const nextImage = scene.assets.find((asset) => asset.type === "image" && asset.url);
      return !nextImage || nextImage.r2Key === previousImageKeys.get(scene.sceneNumber);
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
  const requestedSceneNumbers = body.sceneNumbers?.length
    ? body.sceneNumbers
    : project.currentVersion.scenes.map((scene) => scene.sceneNumber);
  // Persist small batches so a serverless timeout cannot discard an entire storyboard.
  const processingSceneNumbers = requestedSceneNumbers.slice(0, MAX_SCENES_PER_IMAGE_REQUEST);
  const processingScenes = project.currentVersion.scenes.filter((scene) => processingSceneNumbers.includes(scene.sceneNumber));
  const effectiveQuality = body.quality === "premium" || processingScenes.some(sceneRequiresPremiumImage)
    ? "premium"
    : "standard";
  const imageResourceType = effectiveQuality === "premium" ? "image_premium" : "image_standard";
  const billingOperationId = body.billingRequestId
    ?? billingIdempotencyKey(imageResourceType, [body.projectId, body.versionId, "generate", ...processingSceneNumbers]);
  const reservationKey = `asset-image:${billingOperationId}`;
  try {
    await reserveCredits({
      userId: user.id,
      reservationKey,
      items: [{ resourceType: imageResourceType, quantity: processingSceneNumbers.length }],
      metadata: { projectId: body.projectId, versionId: body.versionId, processingSceneNumbers, requestedQuality: body.quality, effectiveQuality }
    });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: error.message, code: "INSUFFICIENT_CREDITS", availableCredits: error.availableCredits, requiredCredits: error.requiredCredits }, { status: 402 });
    }
    throw error;
  }
  try {
  const updated = await generateProjectSceneImages(project, {
    replaceExistingImages: true,
    sceneNumbers: processingSceneNumbers,
    quality: effectiveQuality,
    variantKey: body.variantKey
  });
  let failedTargets = imageFailedScenes(updated.currentVersion.scenes, processingSceneNumbers, previousImageKeys);

  await persistGeneratedSceneAssets(updated.currentVersion.id, updated.currentVersion.scenes, {
    replaceImages: true,
    sceneNumbers: processingSceneNumbers
  });
  const persisted = await loadProjectForRender(body.projectId, body.versionId, user.id);
  if (!persisted) {
    await releaseCreditReservation({
      userId: user.id,
      reservationKey,
      reason: "image_persist_verification_failed",
      metadata: { processingSceneNumbers, requestedQuality: body.quality, effectiveQuality }
    });
    return NextResponse.json({ error: "画面已经生成，但重新读取项目失败，请刷新后重试。" }, { status: 409 });
  }
  const persistedFailedTargets = imageFailedScenes(
    persisted.currentVersion.scenes,
    processingSceneNumbers,
    previousImageKeys
  );
  if (failedTargets.length === 0 && persistedFailedTargets.length > 0) {
    console.error(`[image-assets] Persist verification failed for image scenes: ${persistedFailedTargets.map((scene) => scene.sceneNumber).join(",")}.`);
  }
  failedTargets = failedTargets.length > 0 ? failedTargets : persistedFailedTargets;
  const progress = mediaGenerationProgress(
    processingSceneNumbers,
    failedTargets.map((scene) => scene.sceneNumber)
  );
  const completedScenes = persisted.currentVersion.scenes.filter((scene) => progress.completedSceneNumbers.includes(scene.sceneNumber));
  const billableCompletedScenes = completedScenes.filter((scene) => {
    const source = scene.assets.find((asset) => asset.type === "image" && asset.url)?.metadata?.source;
    return source !== "free-stock-image" && source !== "local-safe-visual";
  });
  const zeroCostVisualRescueSceneNumbers = completedScenes
    .filter((scene) => !billableCompletedScenes.includes(scene))
    .map((scene) => scene.sceneNumber);
  if (billableCompletedScenes.length > 0) {
    const generatedAssets = billableCompletedScenes
      .map((scene) => scene.assets.find((asset) => asset.type === "image" && asset.url))
      .filter((asset) => Boolean(asset));
    const billableImageKeys = generatedAssets.map((asset) => asset?.r2Key).filter((key): key is string => Boolean(key));
    await recordUsageEvent({
      userId: user.id,
      projectId: body.projectId,
      versionId: body.versionId,
      reservationKey,
      resourceType: imageResourceType,
      quantity: billableCompletedScenes.length,
      idempotencyKey: body.billingRequestId
        ? `${imageResourceType}:${body.billingRequestId}`
        : billingIdempotencyKey(imageResourceType, [body.projectId, body.versionId, ...billableImageKeys]),
      status: "settled",
      actualCostUsd: generatedAssets.reduce((sum, asset) => sum + Number(asset?.metadata?.estimatedActualCostUsd ?? 0), 0) || undefined,
      actualModel: typeof generatedAssets[0]?.metadata?.model === "string" ? generatedAssets[0].metadata.model : undefined,
      actualProvider: String(generatedAssets[0]?.metadata?.model ?? "").startsWith("gpt-") ? "openai" : "cloudflare",
      metadata: {
        requestedSceneNumbers: processingSceneNumbers,
        completedSceneNumbers: progress.completedSceneNumbers,
        billedSceneNumbers: billableCompletedScenes.map((scene) => scene.sceneNumber),
        zeroCostVisualRescueSceneNumbers,
        failedSceneNumbers: progress.failedSceneNumbers,
        requestedQuality: body.quality,
        effectiveQuality,
        automaticPremiumUpgrade: body.quality !== effectiveQuality,
        providerRequestCount: generatedAssets.reduce((sum, asset) => sum + Number(asset?.metadata?.providerRequestCount ?? 0), 0),
        validationRequestCount: generatedAssets.reduce((sum, asset) => sum + Number(asset?.metadata?.validationRequestCount ?? 0), 0),
        internalRetriesNotCharged: generatedAssets.reduce((sum, asset) => sum + Math.max(0, Number(asset?.metadata?.providerRequestCount ?? 1) - 1), 0),
        assetKeys: billableImageKeys
      }
    });
  }
  if (progress.completedSceneNumbers.length > 0) {
    await releaseCreditReservation({ userId: user.id, reservationKey, reason: "image_batch_finished" });
  } else {
    await releaseCreditReservation({
      userId: user.id,
      reservationKey,
      reason: "image_generation_failed",
      metadata: { requestedSceneNumbers: processingSceneNumbers, failedSceneNumbers: progress.failedSceneNumbers, requestedQuality: body.quality, effectiveQuality }
    });
  }

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
        project: persisted,
        ...progress
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ project: persisted, ...progress });
  } catch (error) {
    await releaseCreditReservation({
      userId: user.id,
      reservationKey,
      reason: "image_generation_exception",
      metadata: { processingSceneNumbers, requestedQuality: body.quality, effectiveQuality }
    }).catch(() => undefined);
    throw error;
  }
}
