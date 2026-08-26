import { generateProjectVoices } from "@/lib/audio-assets";
import {
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
import { isDeliverableVisualAsset, sceneHasAudioAsset, sceneHasVisualAsset } from "@/lib/generation-resume";

export class ProjectMediaQualityExhaustedError extends Error {
  constructor(sceneNumber: number) {
    super(`Scene ${sceneNumber} visual generation did not produce a usable image.`);
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
  if (sceneAsset(project, message.sceneNumber, "image")) return project;
  const targetScene = project.currentVersion.scenes.find((scene) => scene.sceneNumber === message.sceneNumber);
  // A second queue delivery means the standard model already exhausted its
  // internal quality candidates. Escalate once instead of repeating the same
  // model for many deliveries and leaving the task looking stuck.
  const automaticPremiumUpgrade = deliveryCount >= 2;
  const quality = targetScene && (sceneRequiresPremiumImage(targetScene) || automaticPremiumUpgrade)
    ? "premium"
    : "standard";
  const resourceType = quality === "premium" ? "image_premium" : "image_standard";
  if (quality === "premium" && message.billingReservationKey) {
    const standardCredits = estimateBilling([{ resourceType: "image_standard", quantity: 1 }]).maximumCredits;
    const premium = estimateBilling([{ resourceType: "image_premium", quantity: 1 }]);
    await reserveAdditionalCredits({
      userId: message.userId,
      reservationKey: message.billingReservationKey,
      adjustmentKey: `${message.requestId}:scene:${message.sceneNumber}:premium-upgrade`,
      credits: premium.maximumCredits - standardCredits,
      estimatedCostUsd: Math.max(0, premium.estimatedProviderCostUsd - estimateBilling([{ resourceType: "image_standard", quantity: 1 }]).estimatedProviderCostUsd),
      metadata: { sceneNumber: message.sceneNumber, automaticPremiumUpgrade: true }
    });
  }
  const updated = await generateProjectSceneImages(project, {
    replaceExistingImages: true,
    sceneNumbers: [message.sceneNumber],
    quality,
    variantKey: automaticPremiumUpgrade
      ? `background-premium-rescue-${deliveryCount}`
      : "background-standard",
    // Only the automatically upgraded premium pass may use the guarded
    // fallback. Standard generation must still satisfy the strict style gate.
    allowStyleFallback: automaticPremiumUpgrade,
    // A final queue rescue uses fresh seeds but only two candidates. This
    // raises completion odds without repeating another full four-image pass.
    maxQualityAttempts: deliveryCount >= 3 ? 2 : undefined
  });
  const generated = sceneAsset(updated, message.sceneNumber, "image");
  if (!generated) throw new ProjectMediaQualityExhaustedError(message.sceneNumber);
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
      automaticPremiumUpgrade: quality === "premium",
      providerRequestCount: generated.metadata?.providerRequestCount,
      validationRequestCount: generated.metadata?.validationRequestCount,
      internalRetriesNotCharged: Math.max(0, Number(generated.metadata?.providerRequestCount ?? 1) - 1)
    }
  });
  return requireCurrentProject(message);
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
  return requireCurrentProject(message);
}

async function addFreeStockMotion(message: ProjectMediaMessage, project: Project) {
  if (message.options?.motion !== "stock" || !hasFreeStockVideoProvider()) return project;
  if (sceneAsset(project, message.sceneNumber, "clip")) return project;
  const result = await generateProjectStockClips(project, [message.sceneNumber]);
  await persistGeneratedSceneAssets(message.versionId, result.project.currentVersion.scenes, {
    replaceClips: true,
    sceneNumbers: [message.sceneNumber],
    updateStyles: true
  });
  if (result.failures.length > 0) {
    console.warn(`[background-media] Scene ${message.sceneNumber} has no matching free stock clip; local motion remains active.`);
  }
  return requireCurrentProject(message);
}

export async function processProjectMediaScene(message: ProjectMediaMessage, deliveryCount = 1) {
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
  try {
    project = await ensureSceneNarration(message, project);
  } catch (error) {
    narrationError = error;
    project = await requireCurrentProject(message);
  }

  try {
    project = await addFreeStockMotion(message, project);
  } catch (error) {
    // Free stock is optional because local camera motion remains available.
    console.warn(`[background-media] Scene ${message.sceneNumber} free stock lookup failed; local motion remains active:`, error);
    project = await requireCurrentProject(message);
  }

  const refreshedScene = project.currentVersion.scenes.find((scene) => scene.sceneNumber === message.sceneNumber);
  if (imageError && (!refreshedScene || !sceneHasVisualAsset(refreshedScene))) throw imageError;
  if (narrationError && (!refreshedScene || !sceneHasAudioAsset(refreshedScene))) throw narrationError;

  const sceneNumbers = project.currentVersion.scenes.map((scene) => scene.sceneNumber).sort((a, b) => a - b);
  const currentIndex = sceneNumbers.indexOf(message.sceneNumber);
  const nextSceneNumber = currentIndex >= 0 ? sceneNumbers[currentIndex + 1] : undefined;
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
    await enqueueProjectMediaScene({ ...message, sceneNumber: first.sceneNumber });
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
