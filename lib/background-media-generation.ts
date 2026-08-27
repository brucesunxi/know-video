import { generateProjectVoices } from "@/lib/audio-assets";
import {
  InsufficientCreditsError,
  recordUsageEvent,
  refundCreditReservation,
  releaseCreditReservation,
  reserveAdditionalCredits
} from "@/lib/billing/usage";
import { estimateBilling } from "@/lib/billing/estimate";
import {
  completeGenerationRequest,
  failGenerationRequest,
  touchGenerationRequest
} from "@/lib/generation-requests";
import { generateProjectSceneImages } from "@/lib/image-assets";
import { enqueueProjectMediaScene, type ProjectMediaMessage } from "@/lib/media-generation-queue";
import { loadProjectForRender, persistGeneratedSceneAssets } from "@/lib/project-mutations";
import { generateProjectStockClips, hasFreeStockVideoProvider } from "@/lib/stock-video-assets";
import type { Project, SceneAsset } from "@/lib/types";
import { sceneRequiresPremiumImage } from "@/lib/image-continuity";
import {
  GeneratedImageQualityError,
  isDefinitiveGeneratedImageQualityRejection
} from "@/lib/image-quality";
import { isDeliverableVisualAsset, sceneHasAudioAsset, sceneHasVisualAsset } from "@/lib/generation-resume";
import {
  backgroundImageAttemptPlan,
  canContinueAfterSceneQualityFailure,
  MAX_PROJECT_MEDIA_RECOVERY_PASSES,
  nextProjectRecoveryPass
} from "@/lib/background-recovery-policy";

const BACKGROUND_LONG_WORK_CUTOFF_MS = 190_000;
const BACKGROUND_STOCK_WORK_CUTOFF_MS = 150_000;

export class ProjectMediaQualityExhaustedError extends Error {
  constructor(sceneNumber: number, cause?: unknown) {
    super(`Scene ${sceneNumber} visual generation did not produce a usable image.`, { cause });
    this.name = "ProjectMediaQualityExhaustedError";
  }
}

function sceneAsset(project: Project, sceneNumber: number, type: SceneAsset["type"]) {
  return project.currentVersion.scenes
    .find((scene) => scene.sceneNumber === sceneNumber)
    ?.assets.find((asset) => asset.type === type && asset.url && (type !== "image" || isDeliverableVisualAsset(asset)));
}

async function requireCurrentProject(message: ProjectMediaMessage) {
  const project = await loadProjectForRender(message.projectId, message.versionId, message.userId);
  if (!project) throw new Error("The queued video version is no longer current.");
  return project;
}

async function ensureSceneImage(message: ProjectMediaMessage, project: Project, deliveryCount: number) {
  const targetScene = project.currentVersion.scenes.find((scene) => scene.sceneNumber === message.sceneNumber);
  if (targetScene && sceneHasVisualAsset(targetScene)) return project;
  const requiresPremium = Boolean(targetScene && sceneRequiresPremiumImage(targetScene));
  const attemptPlan = backgroundImageAttemptPlan({
    deliveryCount,
    recoveryPass: message.recoveryPass,
    requiresPremium
  });
  const completionRescue = attemptPlan.completionRescue;
  let quality: "standard" | "premium" = attemptPlan.requestedQuality;
  if (quality === "premium" && message.billingReservationKey) {
    const standardCredits = estimateBilling([{ resourceType: "image_standard", quantity: 1 }]).maximumCredits;
    const premium = estimateBilling([{ resourceType: "image_premium", quantity: 1 }]);
    try {
      await reserveAdditionalCredits({
        userId: message.userId,
        reservationKey: message.billingReservationKey,
        adjustmentKey: `${message.requestId}:scene:${message.sceneNumber}:premium-upgrade`,
        credits: premium.maximumCredits - standardCredits,
        estimatedCostUsd: Math.max(0, premium.estimatedProviderCostUsd - estimateBilling([{ resourceType: "image_standard", quantity: 1 }]).estimatedProviderCostUsd),
        metadata: {
          sceneNumber: message.sceneNumber,
          automaticPremiumUpgrade: completionRescue && !requiresPremium,
          recoveryPass: message.recoveryPass ?? 0
        }
      });
    } catch (error) {
      if (!(error instanceof InsufficientCreditsError) || requiresPremium || !completionRescue) throw error;
      // The user already funded the standard image in the original reservation.
      // A best-effort model upgrade must never turn that funded video into a
      // failed task, so continue with standard generation and settle standard.
      quality = "standard";
      console.warn(`[background-media] Scene ${message.sceneNumber} premium rescue had no additional credit headroom; continuing with the funded standard model.`);
    }
  }
  const resourceType = quality === "premium" ? "image_premium" : "image_standard";
  let updated: Project;
  try {
    updated = await generateProjectSceneImages(project, {
      replaceExistingImages: true,
      sceneNumbers: [message.sceneNumber],
      quality,
      variantKey: completionRescue
        ? `background-${quality}-completion-rescue-${message.recoveryPass ?? 0}-${deliveryCount}`
        : "background-standard",
      // The rescue pass can retain a candidate only for focused independent
      // verification. A known style mismatch or repeated composition is never
      // delivered merely to mark the project complete.
      allowCompletionFallback: completionRescue,
      // Rescue uses one premium candidate plus one FLUX.2 Dev directed recovery
      // candidate, keeping each queue invocation below its execution deadline.
      maxQualityAttempts: attemptPlan.maxQualityAttempts,
      useStockContentGuide: attemptPlan.useStockContentGuide,
      throwOnFailure: true,
      maxProviderAttempts: 1
    });
  } catch (error) {
    if (error instanceof GeneratedImageQualityError && isDefinitiveGeneratedImageQualityRejection(error)) {
      throw new ProjectMediaQualityExhaustedError(message.sceneNumber, error);
    }
    throw error;
  }
  const generated = sceneAsset(updated, message.sceneNumber, "image");
  if (!generated) throw new Error(`Scene ${message.sceneNumber} image generation returned no deliverable asset.`);
  await persistGeneratedSceneAssets(message.versionId, updated.currentVersion.scenes, {
    replaceImages: true,
    sceneNumbers: [message.sceneNumber]
  });
  await recordUsageEvent({
    userId: message.userId,
    projectId: message.projectId,
    versionId: message.versionId,
    reservationKey: message.billingReservationKey,
    resourceType,
    quantity: 1,
    idempotencyKey: `${resourceType}:${message.requestId}:scene:${message.sceneNumber}`,
    status: "settled",
    actualCostUsd: Number(generated.metadata?.estimatedActualCostUsd) || undefined,
    actualModel: typeof generated.metadata?.model === "string" ? generated.metadata.model : undefined,
    actualProvider: String(generated.metadata?.model ?? "").startsWith("gpt-") ? "openai" : "cloudflare",
    metadata: {
      sceneNumber: message.sceneNumber,
      assetKey: generated.r2Key,
      source: "background_queue",
      requestedQuality: "standard",
      effectiveQuality: quality,
      automaticPremiumUpgrade: quality === "premium" && completionRescue && !requiresPremium,
      qualityGate: generated.metadata?.qualityGate,
      completionFallbackReason: generated.metadata?.completionFallbackReason,
      providerRequestCount: generated.metadata?.providerRequestCount,
      validationRequestCount: generated.metadata?.validationRequestCount,
      internalRetriesNotCharged: Math.max(0, Number(generated.metadata?.providerRequestCount ?? 1) - 1)
    }
  });
  return updated;
}

async function ensureSceneNarration(message: ProjectMediaMessage, project: Project) {
  if (sceneAsset(project, message.sceneNumber, "audio")) return project;
  const updated = await generateProjectVoices(
    project,
    [message.sceneNumber],
    message.options?.narrationVoice
  );
  const generated = sceneAsset(updated, message.sceneNumber, "audio");
  if (!generated) throw new Error(`Scene ${message.sceneNumber} narration generation did not produce usable audio.`);
  await persistGeneratedSceneAssets(message.versionId, updated.currentVersion.scenes, {
    replaceAudio: true,
    sceneNumbers: [message.sceneNumber],
    updateStyles: Boolean(message.options?.narrationVoice),
    updateNarration: true
  });
  const duration = Number(generated.metadata?.actualDurationSeconds)
    || project.currentVersion.scenes.find((scene) => scene.sceneNumber === message.sceneNumber)?.durationSeconds
    || 1;
  await recordUsageEvent({
    userId: message.userId,
    projectId: message.projectId,
    versionId: message.versionId,
    reservationKey: message.billingReservationKey,
    resourceType: "speech",
    quantity: duration,
    idempotencyKey: `speech:${message.requestId}:scene:${message.sceneNumber}`,
    status: "settled",
    metadata: {
      sceneNumber: message.sceneNumber,
      narrationVoice: message.options?.narrationVoice,
      assetKey: generated.r2Key,
      source: "background_queue"
    }
  });
  return updated;
}

async function addFreeStockMotion(
  message: ProjectMediaMessage,
  project: Project,
  options: { forceRecoveryFallback?: boolean } = {}
) {
  const forceRecoveryFallback = options.forceRecoveryFallback === true;
  if ((message.options?.motion !== "stock" && !forceRecoveryFallback) || !hasFreeStockVideoProvider()) return project;
  if (sceneAsset(project, message.sceneNumber, "clip")) return project;
  const result = await generateProjectStockClips(project, [message.sceneNumber], {
    recoveryFallback: forceRecoveryFallback
  });
  await persistGeneratedSceneAssets(message.versionId, result.project.currentVersion.scenes, {
    replaceClips: true,
    sceneNumbers: [message.sceneNumber],
    updateStyles: true
  });
  if (result.failures.length > 0) {
    console.warn(`[background-media] Scene ${message.sceneNumber} has no matching free stock clip; local motion remains active.`);
  } else if (forceRecoveryFallback && result.styleProtectedSceneNumbers.includes(message.sceneNumber)) {
    console.warn(`[background-media] Scene ${message.sceneNumber} kept its non-photographic style; free stock was not used as a recovery fallback.`);
  }
  return result.project;
}

export async function processProjectMediaScene(message: ProjectMediaMessage, deliveryCount = 1) {
  const callbackStartedAt = Date.now();
  const canStartLongWork = () => Date.now() - callbackStartedAt < BACKGROUND_LONG_WORK_CUTOFF_MS;
  const canStartStockWork = () => Date.now() - callbackStartedAt < BACKGROUND_STOCK_WORK_CUTOFF_MS;
  await touchGenerationRequest(message.requestId);
  let project = await requireCurrentProject(message);
  let imageError: unknown;
  let narrationError: unknown;

  try {
    project = await ensureSceneImage(message, project, deliveryCount);
  } catch (error) {
    imageError = error;
    project = await requireCurrentProject(message);
  }

  // Narration is independent from the visual candidate. Complete and persist
  // it even when this delivery needs to retry the image, then skip it on the
  // next delivery instead of leaving both assets missing.
  if (canStartLongWork()) {
    try {
      project = await ensureSceneNarration(message, project);
    } catch (error) {
      narrationError = error;
      project = await requireCurrentProject(message);
    }
  } else {
    console.warn(`[background-media] Scene ${message.sceneNumber} narration was deferred to keep this queue callback inside its execution budget.`);
  }

  if (canStartStockWork()) {
    try {
      project = await addFreeStockMotion(message, project, {
        forceRecoveryFallback: imageError instanceof ProjectMediaQualityExhaustedError
          && canContinueAfterSceneQualityFailure(deliveryCount, message.recoveryPass)
      });
    } catch (error) {
      // Free stock is optional because local camera motion remains available.
      console.warn(`[background-media] Scene ${message.sceneNumber} free stock lookup failed; local motion remains active:`, error);
      project = await requireCurrentProject(message);
    }
  } else {
    console.warn(`[background-media] Scene ${message.sceneNumber} free stock lookup was deferred to keep this queue callback inside its execution budget.`);
  }

  const refreshedScene = project.currentVersion.scenes.find((scene) => scene.sceneNumber === message.sceneNumber);
  const missingVisualAfterAttempt = !refreshedScene || !sceneHasVisualAsset(refreshedScene);
  const qualityFailureCanEnterProjectRecovery = imageError instanceof ProjectMediaQualityExhaustedError
    && canContinueAfterSceneQualityFailure(deliveryCount, message.recoveryPass);
  if (imageError && missingVisualAfterAttempt && !qualityFailureCanEnterProjectRecovery) throw imageError;
  if (narrationError && (!refreshedScene || !sceneHasAudioAsset(refreshedScene))) throw narrationError;

  const nextSceneNumber = project.currentVersion.scenes
    .filter((scene) => scene.sceneNumber > message.sceneNumber)
    .filter((scene) => !sceneHasVisualAsset(scene) || !sceneHasAudioAsset(scene))
    .sort((left, right) => left.sceneNumber - right.sceneNumber)[0]?.sceneNumber;
  if (nextSceneNumber) {
    await enqueueProjectMediaScene({ ...message, sceneNumber: nextSceneNumber });
    return;
  }

  const refreshed = await requireCurrentProject(message);
  const incomplete = refreshed.currentVersion.scenes.filter((scene) => {
    return !sceneHasVisualAsset(scene) || !sceneHasAudioAsset(scene);
  });
  if (incomplete.length > 0) {
    const first = incomplete.sort((a, b) => a.sceneNumber - b.sceneNumber)[0];
    const recoveryPass = nextProjectRecoveryPass(message.recoveryPass);
    if (recoveryPass > MAX_PROJECT_MEDIA_RECOVERY_PASSES) {
      // Preserve the quality error type so the queue consumer stops after its
      // bounded second delivery instead of treating this as a transient outage
      // and repeating two more expensive generation cycles.
      if (imageError instanceof ProjectMediaQualityExhaustedError) throw imageError;
      throw new Error(`Project media remained incomplete after ${recoveryPass - 1} recovery passes.`);
    }
    await enqueueProjectMediaScene({
      ...message,
      sceneNumber: first.sceneNumber,
      recoveryPass
    });
    return;
  }
  await completeGenerationRequest({
    id: message.requestId,
    projectId: message.projectId,
    engine: message.engine
  });
  if (message.billingReservationKey) {
    await releaseCreditReservation({
      userId: message.userId,
      reservationKey: message.billingReservationKey,
      reason: "project_generation_completed",
      metadata: { projectId: message.projectId, versionId: message.versionId }
    });
  }
}

export async function permanentlyFailProjectMedia(message: ProjectMediaMessage, error: unknown) {
  const reason = error instanceof ProjectMediaQualityExhaustedError
    ? `场景 ${message.sceneNumber} 的候选画面均未通过内容与风格质量检查。`
    : error instanceof Error ? error.message : "Unknown media generation failure";
  await failGenerationRequest(
    message.requestId,
    `后台已多次自动重试，但场景 ${message.sceneNumber} 的素材仍未完成：${reason}`
  );
  if (message.billingReservationKey) {
    await refundCreditReservation({
      userId: message.userId,
      reservationKey: message.billingReservationKey,
      reason: "project_media_permanently_failed",
      metadata: { sceneNumber: message.sceneNumber, error: reason }
    });
  }
}
