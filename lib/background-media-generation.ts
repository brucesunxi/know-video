import { generateProjectVoices } from "@/lib/audio-assets";
import {
  InsufficientCreditsError,
  recordUsageEvent,
  reserveAdditionalCredits
} from "@/lib/billing/usage";
import { estimateBilling } from "@/lib/billing/estimate";
import {
  completeGenerationRequest,
  failGenerationRequest,
  getGenerationRequestBeforeExpiry,
  touchGenerationRequest
} from "@/lib/generation-requests";
import { generateProjectSceneImages } from "@/lib/image-assets";
import {
  elapsedGenerationMs,
  GENERATION_PLANNING_TIMEOUT_MINUTES,
  generationExceededRuntime,
  generationMediaIsInactive,
  generationResumeAttempt
} from "@/lib/generation-lifecycle-policy";
import {
  enqueueProjectGenerationWatchdog,
  enqueueProjectMediaScene,
  type ProjectGenerationWatchdogMessage,
  type ProjectMediaSceneMessage
} from "@/lib/media-generation-queue";
import { loadProjectForRender, persistGeneratedSceneAssets } from "@/lib/project-mutations";
import { getProjectSnapshot } from "@/lib/project-store";
import { generateProjectStockClips, hasFreeStockVideoProvider } from "@/lib/stock-video-assets";
import { styleAllowsFreeStockVideo } from "@/lib/style-motion-policy";
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
import {
  backgroundBillingMarkerForAsset,
  tagAssetForBackgroundBilling
} from "@/lib/background-media-billing";

const BACKGROUND_LONG_WORK_CUTOFF_MS = 190_000;
const BACKGROUND_STOCK_WORK_CUTOFF_MS = 150_000;
const BACKGROUND_CALLBACK_WORK_DEADLINE_MS = 260_000;
const BACKGROUND_PROJECT_RUNTIME_LIMIT_MS = 35 * 60 * 1_000;

export class ProjectMediaQualityExhaustedError extends Error {
  constructor(sceneNumber: number, cause?: unknown) {
    super(`Scene ${sceneNumber} visual generation did not produce a usable image.`, { cause });
    this.name = "ProjectMediaQualityExhaustedError";
  }
}

export class ProjectMediaRuntimeExceededError extends Error {
  constructor() {
    super("Project media generation exceeded its maximum runtime.");
    this.name = "ProjectMediaRuntimeExceededError";
  }
}

function sceneAsset(project: Project, sceneNumber: number, type: SceneAsset["type"]) {
  return project.currentVersion.scenes
    .find((scene) => scene.sceneNumber === sceneNumber)
    ?.assets.find((asset) => asset.type === type && asset.url && (type !== "image" || isDeliverableVisualAsset(asset)));
}

// Once any deliverable still exists, keep the rest of the project on the same
// image-plus-local-motion path instead of creating a mixed-media patchwork.
function projectAllowsFreeStockVideo(
  project: Project,
  requestedMotion: NonNullable<ProjectMediaSceneMessage["options"]>["motion"] | undefined
) {
  if (requestedMotion !== "stock") return false;
  return !project.currentVersion.scenes.some((scene) => scene.assets.some((asset) => (
    asset.type === "image" && isDeliverableVisualAsset(asset)
  )));
}

async function settleBackgroundImageUsage(message: ProjectMediaSceneMessage, asset: SceneAsset | undefined) {
  const marker = backgroundBillingMarkerForAsset(asset, message.requestId);
  if (!asset || !marker || marker.resourceType === "speech") return false;
  const effectiveQuality = marker.resourceType === "image_premium" ? "premium" : "standard";
  await recordUsageEvent({
    userId: message.userId,
    projectId: message.projectId,
    versionId: message.versionId,
    reservationKey: message.billingReservationKey,
    resourceType: marker.resourceType,
    quantity: marker.quantity,
    idempotencyKey: `${marker.resourceType}:${message.requestId}:scene:${message.sceneNumber}`,
    status: "settled",
    actualCostUsd: Number(asset.metadata?.estimatedActualCostUsd) || undefined,
    actualModel: typeof asset.metadata?.model === "string" ? asset.metadata.model : undefined,
    actualProvider: String(asset.metadata?.model ?? "").startsWith("gpt-") ? "openai" : "cloudflare",
    metadata: {
      sceneNumber: message.sceneNumber,
      assetKey: asset.r2Key,
      source: "background_queue",
      requestedQuality: asset.metadata?.backgroundRequestedQuality ?? effectiveQuality,
      effectiveQuality: asset.metadata?.backgroundEffectiveQuality ?? effectiveQuality,
      automaticPremiumUpgrade: asset.metadata?.backgroundAutomaticPremiumUpgrade === true,
      qualityGate: asset.metadata?.qualityGate,
      completionFallbackReason: asset.metadata?.completionFallbackReason,
      providerRequestCount: asset.metadata?.providerRequestCount,
      validationRequestCount: asset.metadata?.validationRequestCount,
      internalRetriesNotCharged: Math.max(0, Number(asset.metadata?.providerRequestCount ?? 1) - 1),
      retrySafeSettlement: true
    }
  });
  return true;
}

async function settleBackgroundNarrationUsage(message: ProjectMediaSceneMessage, asset: SceneAsset | undefined) {
  const marker = backgroundBillingMarkerForAsset(asset, message.requestId);
  if (!asset || !marker || marker.resourceType !== "speech") return false;
  await recordUsageEvent({
    userId: message.userId,
    projectId: message.projectId,
    versionId: message.versionId,
    reservationKey: message.billingReservationKey,
    resourceType: marker.resourceType,
    quantity: marker.quantity,
    idempotencyKey: `speech:${message.requestId}:scene:${message.sceneNumber}`,
    status: "settled",
    actualModel: typeof asset.metadata?.model === "string" ? asset.metadata.model : undefined,
    actualProvider: String(asset.metadata?.model ?? "").startsWith("gpt-") ? "openai" : "azure",
    metadata: {
      sceneNumber: message.sceneNumber,
      narrationVoice: message.options?.narrationVoice,
      assetKey: asset.r2Key,
      source: "background_queue",
      retrySafeSettlement: true
    }
  });
  return true;
}

async function requireCurrentProject(message: ProjectMediaSceneMessage) {
  const project = await loadProjectForRender(message.projectId, message.versionId, message.userId);
  if (!project) throw new Error("The queued video version is no longer current.");
  return project;
}

async function ensureSceneImage(
  message: ProjectMediaSceneMessage,
  project: Project,
  deliveryCount: number,
  deadlineMs: number
) {
  const targetScene = project.currentVersion.scenes.find((scene) => scene.sceneNumber === message.sceneNumber);
  if (targetScene && sceneHasVisualAsset(targetScene)) {
    await settleBackgroundImageUsage(message, sceneAsset(project, message.sceneNumber, "image"));
    return project;
  }
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
      maxStockContentGuides: completionRescue ? 3 : 1,
      allowLocallyTrustedStockFallback: completionRescue,
      throwOnFailure: true,
      maxProviderAttempts: 1,
      deadlineMs
    });
  } catch (error) {
    if (error instanceof GeneratedImageQualityError && isDefinitiveGeneratedImageQualityRejection(error)) {
      throw new ProjectMediaQualityExhaustedError(message.sceneNumber, error);
    }
    throw error;
  }
  const generated = sceneAsset(updated, message.sceneNumber, "image");
  if (!generated) throw new Error(`Scene ${message.sceneNumber} image generation returned no deliverable asset.`);
  const freeStockRescue = generated.metadata?.source === "free-stock-image";
  if (!freeStockRescue) {
    const tagged = tagAssetForBackgroundBilling({
      ...generated,
      metadata: {
        ...generated.metadata,
        backgroundRequestedQuality: attemptPlan.requestedQuality,
        backgroundEffectiveQuality: quality,
        backgroundAutomaticPremiumUpgrade: quality === "premium" && completionRescue && !requiresPremium
      }
    }, {
      requestId: message.requestId,
      resourceType,
      quantity: 1
    });
    generated.metadata = tagged.metadata;
  }
  await persistGeneratedSceneAssets(message.versionId, updated.currentVersion.scenes, {
    replaceImages: true,
    sceneNumbers: [message.sceneNumber]
  });
  if (!freeStockRescue) await settleBackgroundImageUsage(message, generated);
  return updated;
}

async function ensureSceneNarration(
  message: ProjectMediaSceneMessage,
  project: Project,
  deadlineMs: number
) {
  const existingAudio = sceneAsset(project, message.sceneNumber, "audio");
  if (existingAudio) {
    await settleBackgroundNarrationUsage(message, existingAudio);
    return project;
  }
  const updated = await generateProjectVoices(
    project,
    [message.sceneNumber],
    message.options?.narrationVoice,
    {
      deadlineMs,
      azureMaxAttempts: 1,
      allowOpenAIFallback: false
    }
  );
  const generated = sceneAsset(updated, message.sceneNumber, "audio");
  if (!generated) throw new Error(`Scene ${message.sceneNumber} narration generation did not produce usable audio.`);
  const duration = Number(generated.metadata?.actualDurationSeconds)
    || project.currentVersion.scenes.find((scene) => scene.sceneNumber === message.sceneNumber)?.durationSeconds
    || 1;
  const tagged = tagAssetForBackgroundBilling(generated, {
    requestId: message.requestId,
    resourceType: "speech",
    quantity: duration
  });
  generated.metadata = tagged.metadata;
  await persistGeneratedSceneAssets(message.versionId, updated.currentVersion.scenes, {
    replaceAudio: true,
    sceneNumbers: [message.sceneNumber],
    updateStyles: Boolean(message.options?.narrationVoice),
    updateNarration: true
  });
  await settleBackgroundNarrationUsage(message, generated);
  return updated;
}

async function addFreeStockMotion(
  message: ProjectMediaSceneMessage,
  project: Project,
  options: { forceRecoveryFallback?: boolean; deadlineMs?: number } = {}
) {
  const forceRecoveryFallback = options.forceRecoveryFallback === true;
  if (message.options?.motion !== "stock" || !hasFreeStockVideoProvider()) return project;
  if (sceneAsset(project, message.sceneNumber, "clip")) return project;
  const result = await generateProjectStockClips(project, [message.sceneNumber], {
    recoveryFallback: forceRecoveryFallback,
    deadlineMs: options.deadlineMs
  });
  if (result.failures.length > 0) {
    console.warn(`[background-media] Scene ${message.sceneNumber} has no matching free stock clip; local motion remains active.`);
    return project;
  }
  await persistGeneratedSceneAssets(message.versionId, result.project.currentVersion.scenes, {
    replaceClips: true,
    sceneNumbers: [message.sceneNumber],
    updateStyles: true
  });
  if (forceRecoveryFallback && result.styleProtectedSceneNumbers.includes(message.sceneNumber)) {
    console.warn(`[background-media] Scene ${message.sceneNumber} kept its non-photographic style; free stock was not used as a recovery fallback.`);
  }
  return result.project;
}

export async function processProjectMediaScene(message: ProjectMediaSceneMessage, deliveryCount = 1) {
  const callbackStartedAt = Date.now();
  const callbackWorkDeadline = callbackStartedAt + BACKGROUND_CALLBACK_WORK_DEADLINE_MS;
  const canStartLongWork = () => Date.now() - callbackStartedAt < BACKGROUND_LONG_WORK_CUTOFF_MS;
  const canStartStockWork = () => Date.now() - callbackStartedAt < BACKGROUND_STOCK_WORK_CUTOFF_MS;
  const heartbeat = await touchGenerationRequest(message.requestId);
  if (!heartbeat.pending) {
    console.info(`[background-media] Ignoring stale message for inactive request ${message.requestId}.`);
    return;
  }
  const mediaStartedAt = Number.isFinite(message.startedAt)
    ? Number(message.startedAt)
    : heartbeat.createdAt ? Date.parse(heartbeat.createdAt) : callbackStartedAt;
  if (Number.isFinite(mediaStartedAt) && callbackStartedAt - mediaStartedAt >= BACKGROUND_PROJECT_RUNTIME_LIMIT_MS) {
    console.error(`[background-media] Request ${message.requestId} exceeded the 35-minute media runtime limit.`);
    await permanentlyFailProjectMedia(message, new ProjectMediaRuntimeExceededError());
    return;
  }
  let project = await requireCurrentProject(message);
  let stockAttemptedBeforeImage = false;
  let imageError: unknown;
  let narrationError: unknown;

  const initialScene = project.currentVersion.scenes.find((scene) => scene.sceneNumber === message.sceneNumber);
  const shouldTryStockBeforeImage = Boolean(
    initialScene
    && !sceneHasVisualAsset(initialScene)
    && styleAllowsFreeStockVideo(initialScene.style)
    && projectAllowsFreeStockVideo(project, message.options?.motion)
  );
  if (shouldTryStockBeforeImage && canStartStockWork()) {
    stockAttemptedBeforeImage = true;
    try {
      project = await addFreeStockMotion(message, project, {
        forceRecoveryFallback: deliveryCount >= 2 || (message.recoveryPass ?? 0) > 0,
        deadlineMs: callbackWorkDeadline
      });
    } catch (error) {
      console.warn(`[background-media] Scene ${message.sceneNumber} free stock preflight failed; continuing with image generation:`, error);
      project = await requireCurrentProject(message);
    }
  }

  try {
    project = await ensureSceneImage(message, project, deliveryCount, callbackWorkDeadline);
  } catch (error) {
    imageError = error;
    project = await requireCurrentProject(message);
    const persistedImage = sceneAsset(project, message.sceneNumber, "image");
    if (await settleBackgroundImageUsage(message, persistedImage)) imageError = undefined;
  }

  // Narration is independent from the visual candidate. Complete and persist
  // it even when this delivery needs to retry the image, then skip it on the
  // next delivery instead of leaving both assets missing.
  if (canStartLongWork()) {
    try {
      project = await ensureSceneNarration(message, project, callbackWorkDeadline);
    } catch (error) {
      narrationError = error;
      project = await requireCurrentProject(message);
      const persistedAudio = sceneAsset(project, message.sceneNumber, "audio");
      if (await settleBackgroundNarrationUsage(message, persistedAudio)) narrationError = undefined;
    }
  } else {
    console.warn(`[background-media] Scene ${message.sceneNumber} narration was deferred to keep this queue callback inside its execution budget.`);
  }

  const stockFallbackScene = project.currentVersion.scenes.find((scene) => scene.sceneNumber === message.sceneNumber);
  const stockVideoFallbackAllowed = Boolean(
    stockFallbackScene
    && styleAllowsFreeStockVideo(stockFallbackScene.style)
    && projectAllowsFreeStockVideo(project, message.options?.motion)
  );
  if (!stockAttemptedBeforeImage && stockVideoFallbackAllowed && canStartStockWork()) {
    try {
      project = await addFreeStockMotion(message, project, {
        forceRecoveryFallback: imageError instanceof ProjectMediaQualityExhaustedError
          && canContinueAfterSceneQualityFailure(deliveryCount, message.recoveryPass),
        deadlineMs: callbackWorkDeadline
      });
    } catch (error) {
      // Free stock is optional because local camera motion remains available.
      console.warn(`[background-media] Scene ${message.sceneNumber} free stock lookup failed; local motion remains active:`, error);
      project = await requireCurrentProject(message);
    }
  } else if (!stockAttemptedBeforeImage && stockVideoFallbackAllowed) {
    console.warn(`[background-media] Scene ${message.sceneNumber} free stock lookup was deferred to keep this queue callback inside its execution budget.`);
  }

  const refreshedScene = project.currentVersion.scenes.find((scene) => scene.sceneNumber === message.sceneNumber);
  const missingVisualAfterAttempt = !refreshedScene || !sceneHasVisualAsset(refreshedScene);
  const qualityFailureCanEnterProjectRecovery = imageError instanceof ProjectMediaQualityExhaustedError
    && canContinueAfterSceneQualityFailure(deliveryCount, message.recoveryPass);
  if (imageError && missingVisualAfterAttempt && !qualityFailureCanEnterProjectRecovery) throw imageError;

  // A narration failure must not strand visual recovery work from earlier
  // scenes. Keep walking the project, then revisit every incomplete scene in
  // the bounded recovery pass. If narration is still missing at the end of
  // that pass, surface the original provider/quality error to the queue.
  const missingNarrationAfterAttempt = !refreshedScene || !sceneHasAudioAsset(refreshedScene);

  const nextSceneNumber = project.currentVersion.scenes
    .filter((scene) => scene.sceneNumber > message.sceneNumber)
    .filter((scene) => !sceneHasVisualAsset(scene) || !sceneHasAudioAsset(scene))
    .sort((left, right) => left.sceneNumber - right.sceneNumber)[0]?.sceneNumber;
  if (nextSceneNumber) {
    await enqueueProjectMediaScene({ ...message, sceneNumber: nextSceneNumber });
    return;
  }

  const incomplete = project.currentVersion.scenes.filter((scene) => {
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
      if (narrationError && missingNarrationAfterAttempt) throw narrationError;
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
    userId: message.userId,
    projectId: message.projectId,
    engine: message.engine,
    billingReservationKey: message.billingReservationKey,
    releaseReason: "project_generation_completed",
    metadata: { versionId: message.versionId }
  });
}

export async function permanentlyFailProjectMedia(message: ProjectMediaSceneMessage, error: unknown) {
  const reason = error instanceof ProjectMediaQualityExhaustedError
    ? `场景 ${message.sceneNumber} 的候选画面均未通过内容与风格质量检查。`
    : error instanceof ProjectMediaRuntimeExceededError
      ? "后台媒体生成已达到 35 分钟运行上限。"
    : error instanceof Error ? error.message : "Unknown media generation failure";
  await failGenerationRequest({
    id: message.requestId,
    userId: message.userId,
    error: `后台已多次自动重试，但场景 ${message.sceneNumber} 的素材仍未完成：${reason}`,
    billingReservationKey: message.billingReservationKey,
    refundReason: "project_media_permanently_failed",
    metadata: { sceneNumber: message.sceneNumber, error: reason }
  });
}

export async function permanentlyFailProjectGenerationWatchdog(
  message: ProjectGenerationWatchdogMessage,
  error: unknown
) {
  const generation = await getGenerationRequestBeforeExpiry(message.requestId, message.userId);
  if (!generation) return;
  const metadata = {
    watchdogPass: message.watchdogPass ?? 0,
    errorType: error instanceof Error ? error.name : "UnknownError",
    terminalWatchdogFinalizer: true
  };
  if (generation.status === "ready") {
    if (!generation.projectId) {
      throw new Error(`Ready generation request ${message.requestId} has no project.`);
    }
    await completeGenerationRequest({
      id: message.requestId,
      userId: message.userId,
      projectId: generation.projectId,
      engine: generation.engine ?? "ai",
      billingReservationKey: message.billingReservationKey,
      releaseReason: "project_generation_watchdog_terminal_repair",
      metadata
    });
    return;
  }
  await failGenerationRequest({
    id: message.requestId,
    userId: message.userId,
    error: generation.status === "failed"
      ? generation.error
      : "后台状态检查连续失败，系统已停止本次任务并退回 Credits。请重新生成。",
    billingReservationKey: message.billingReservationKey,
    refundReason: "project_generation_watchdog_failed",
    metadata
  });
}

export async function processProjectGenerationWatchdog(message: ProjectGenerationWatchdogMessage) {
  const generation = await getGenerationRequestBeforeExpiry(message.requestId, message.userId);
  if (!generation) return;
  if (generation.status === "ready" && generation.projectId) {
    await completeGenerationRequest({
      id: message.requestId,
      userId: message.userId,
      projectId: generation.projectId,
      engine: generation.engine ?? "ai",
      billingReservationKey: message.billingReservationKey,
      releaseReason: "project_generation_watchdog_terminal_repair",
      metadata: { repairedTerminalBilling: true }
    });
    return;
  }
  if (generation.status === "failed") {
    await failGenerationRequest({
      id: message.requestId,
      userId: message.userId,
      error: generation.error,
      billingReservationKey: message.billingReservationKey,
      refundReason: "project_generation_watchdog_terminal_repair",
      metadata: { repairedTerminalBilling: true }
    });
    return;
  }

  const watchdogPass = message.watchdogPass ?? 0;
  const enqueueNextWatchdog = () => enqueueProjectGenerationWatchdog({
    ...message,
    watchdogPass: watchdogPass + 1
  });
  const runtimeExceeded = generationExceededRuntime(generation.createdAt);
  const mediaInactive = generationMediaIsInactive(generation.updatedAt);
  const planningTimedOut = !generation.projectId
    && elapsedGenerationMs(generation.updatedAt) >= GENERATION_PLANNING_TIMEOUT_MINUTES * 60_000;

  if (!generation.projectId && !runtimeExceeded && !planningTimedOut) {
    await enqueueNextWatchdog();
    return;
  }

  const snapshot = generation.projectId
    ? await getProjectSnapshot(generation.projectId, message.userId)
    : undefined;
  const project = snapshot?.project;
  const scenes = project?.currentVersion.scenes ?? [];
  const assetsComplete = scenes.length > 0
    && scenes.every((scene) => sceneHasVisualAsset(scene) && sceneHasAudioAsset(scene));

  if (project && assetsComplete) {
    for (const scene of scenes) {
      const settlementMessage: ProjectMediaSceneMessage = {
        requestId: message.requestId,
        userId: message.userId,
        projectId: project.id,
        versionId: project.currentVersion.id,
        sceneNumber: scene.sceneNumber,
        engine: generation.engine ?? "ai",
        billingReservationKey: message.billingReservationKey,
        options: generation.options
      };
      await settleBackgroundImageUsage(settlementMessage, sceneAsset(project, scene.sceneNumber, "image"));
      await settleBackgroundNarrationUsage(settlementMessage, sceneAsset(project, scene.sceneNumber, "audio"));
    }
    await completeGenerationRequest({
      id: message.requestId,
      userId: message.userId,
      projectId: project.id,
      engine: generation.engine ?? "ai",
      billingReservationKey: message.billingReservationKey,
      releaseReason: "project_generation_watchdog_reconciled",
      metadata: { versionId: project.currentVersion.id }
    });
    return;
  }

  if (project && scenes.length > 0 && !runtimeExceeded && mediaInactive) {
    const firstIncomplete = scenes
      .filter((scene) => !sceneHasVisualAsset(scene) || !sceneHasAudioAsset(scene))
      .sort((left, right) => left.sceneNumber - right.sceneNumber)[0];
    if (firstIncomplete) {
      const resumeAttempt = generationResumeAttempt(generation.createdAt);
      const startedAt = Date.parse(generation.createdAt);
      await enqueueNextWatchdog();
      await enqueueProjectMediaScene({
        requestId: message.requestId,
        userId: message.userId,
        projectId: project.id,
        versionId: project.currentVersion.id,
        sceneNumber: firstIncomplete.sceneNumber,
        engine: generation.engine ?? "ai",
        billingReservationKey: message.billingReservationKey,
        options: generation.options,
        recoveryPass: 0,
        resumeAttempt,
        startedAt: Number.isFinite(startedAt) ? startedAt : Date.now()
      });
      await touchGenerationRequest(message.requestId);
      return;
    }
  }

  if (!runtimeExceeded && !planningTimedOut && project && scenes.length > 0) {
    await enqueueNextWatchdog();
    return;
  }

  await failGenerationRequest({
    id: message.requestId,
    userId: message.userId,
    error: generation.projectId
      ? "后台生成已达到运行上限或没有保存出可恢复分镜，系统已自动停止并退回本次 Credits。请重试缺失场景。"
      : "脚本与分镜规划在 15 分钟内没有完成，系统已自动停止并退回本次 Credits。请重新生成。",
    billingReservationKey: message.billingReservationKey,
    refundReason: "project_generation_watchdog_timed_out",
    metadata: {
      projectId: generation.projectId,
      watchdogPass,
      runtimeExceeded,
      mediaInactive,
      completedScenes: scenes.filter((scene) => sceneHasVisualAsset(scene) && sceneHasAudioAsset(scene)).length,
      totalScenes: scenes.length
    }
  });
}
