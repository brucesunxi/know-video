import { releaseCreditReservation } from "@/lib/billing/usage";
import {
  completeGenerationRequest,
  type GenerationRequestRecord
} from "@/lib/generation-requests";
import { sceneHasAudioAsset, sceneHasVisualAsset } from "@/lib/generation-resume";
import { getProjectSnapshot } from "@/lib/project-store";

async function finalizeCompletedGenerationRequest(
  generation: GenerationRequestRecord,
  userId: string
) {
  if (generation.status !== "pending" || !generation.projectId) return generation;

  await releaseCreditReservation({
    userId,
    reservationKey: `project-generation:${generation.id}`,
    reason: "project_generation_reconciled",
    metadata: { projectId: generation.projectId }
  });
  await completeGenerationRequest({
    id: generation.id,
    projectId: generation.projectId,
    engine: generation.engine ?? "ai"
  });

  return { ...generation, status: "ready" as const, error: undefined };
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
  await Promise.all(generations.map((generation) => finalizeCompletedGenerationRequest(generation, userId)));
}
