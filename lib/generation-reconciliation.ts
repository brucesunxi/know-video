import {
  completeGenerationRequest,
  failGenerationRequest,
  getGenerationRequestBeforeExpiry,
  touchGenerationRequest,
  type GenerationRequestRecord
} from "@/lib/generation-requests";
import {
  generationExceededRuntime,
  generationMediaIsInactive,
  generationResumeAttempt
} from "@/lib/generation-lifecycle-policy";
import {
  enqueueProjectGenerationWatchdog,
  enqueueProjectMediaScene
} from "@/lib/media-generation-queue";
import { sceneHasAudioAsset, sceneHasVisualAsset } from "@/lib/generation-resume";
import { getProjectSnapshot } from "@/lib/project-store";

async function finalizeCompletedGenerationRequest(
  generation: GenerationRequestRecord,
  userId: string
) {
  if (generation.status !== "pending" || !generation.projectId) return generation;

  await completeGenerationRequest({
    id: generation.id,
    userId,
    projectId: generation.projectId,
    engine: generation.engine ?? "ai",
    releaseReason: "project_generation_reconciled"
  });

  return await getGenerationRequestBeforeExpiry(generation.id, userId)
    ?? { ...generation, status: "ready" as const, error: undefined };
}

export async function reconcileCompletedGenerationRequest(
  generation: GenerationRequestRecord,
  userId: string
) {
  if (generation.status !== "pending" || !generation.projectId) return generation;

  const snapshot = await getProjectSnapshot(generation.projectId, userId);
  const scenes = snapshot?.project.currentVersion.scenes ?? [];
  const assetsComplete = scenes.length > 0
    && scenes.every((scene) => sceneHasVisualAsset(scene) && sceneHasAudioAsset(scene));

  if (!assetsComplete) return generation;
  return finalizeCompletedGenerationRequest(generation, userId);
}

export async function reconcileCompletedGenerationRequests(
  generations: GenerationRequestRecord[],
  userId: string
) {
  for (const generation of generations) {
    await finalizeCompletedGenerationRequest(generation, userId);
  }
}

async function failedRecoveryRecord(
  generation: GenerationRequestRecord,
  userId: string,
  error: string,
  refundReason: string
) {
  await failGenerationRequest({
    id: generation.id,
    userId,
    error,
    refundReason,
    metadata: { projectId: generation.projectId, automaticRecovery: true }
  });
  return await getGenerationRequestBeforeExpiry(generation.id, userId)
    ?? { ...generation, status: "failed" as const, error };
}

export async function recoverStalledGenerationRequest(
  generation: GenerationRequestRecord,
  userId: string,
  now = Date.now()
) {
  if (generation.status !== "pending" || !generation.projectId) return generation;

  const runtimeExceeded = generationExceededRuntime(generation.createdAt, now);
  const mediaInactive = generationMediaIsInactive(generation.updatedAt, now);
  if (!runtimeExceeded && !mediaInactive) return generation;

  const snapshot = await getProjectSnapshot(generation.projectId, userId);
  const project = snapshot?.project;
  const scenes = project?.currentVersion.scenes ?? [];
  const assetsComplete = scenes.length > 0
    && scenes.every((scene) => sceneHasVisualAsset(scene) && sceneHasAudioAsset(scene));
  if (assetsComplete) return finalizeCompletedGenerationRequest(generation, userId);

  if (runtimeExceeded) {
    return failedRecoveryRecord(
      generation,
      userId,
      "后台生成已达到 40 分钟运行上限，系统已自动停止并退回本次 Credits。请重试缺失场景。",
      "project_generation_runtime_exceeded"
    );
  }
  if (!project || scenes.length === 0) {
    return failedRecoveryRecord(
      generation,
      userId,
      "后台任务没有保存出可恢复的分镜，系统已停止任务并退回本次 Credits。请重新生成。",
      "project_generation_unrecoverable"
    );
  }

  const firstIncomplete = scenes
    .filter((scene) => !sceneHasVisualAsset(scene) || !sceneHasAudioAsset(scene))
    .sort((left, right) => left.sceneNumber - right.sceneNumber)[0];
  if (!firstIncomplete) return finalizeCompletedGenerationRequest(generation, userId);

  const resumeAttempt = generationResumeAttempt(generation.createdAt, now);
  await enqueueProjectGenerationWatchdog({
    operation: "watchdog",
    requestId: generation.id,
    userId,
    billingReservationKey: `project-generation:${generation.id}`,
    watchdogPass: resumeAttempt
  });
  const startedAt = Date.parse(generation.createdAt);
  await enqueueProjectMediaScene({
    requestId: generation.id,
    userId,
    projectId: project.id,
    versionId: project.currentVersion.id,
    sceneNumber: firstIncomplete.sceneNumber,
    engine: generation.engine ?? "ai",
    billingReservationKey: `project-generation:${generation.id}`,
    options: generation.options,
    recoveryPass: 0,
    resumeAttempt,
    startedAt: Number.isFinite(startedAt) ? startedAt : now
  });
  await touchGenerationRequest(generation.id);
  return { ...generation, updatedAt: new Date(now).toISOString() };
}

export async function recoverStalledGenerationRequests(
  generations: GenerationRequestRecord[],
  userId: string,
  now = Date.now()
) {
  const recovered: GenerationRequestRecord[] = [];
  for (const generation of generations) {
    recovered.push(generation.status === "pending"
      && generation.projectId
      && (
        generationMediaIsInactive(generation.updatedAt, now)
        || generationExceededRuntime(generation.createdAt, now)
      )
      ? await recoverStalledGenerationRequest(generation, userId, now)
      : generation);
  }
  return recovered;
}
