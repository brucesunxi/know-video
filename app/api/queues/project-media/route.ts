import { handleCallback } from "@vercel/queue";
import {
  permanentlyFailProjectMedia,
  ProjectMediaQualityExhaustedError,
  processProjectMediaScene
} from "@/lib/background-media-generation";
import type { ProjectMediaMessage } from "@/lib/media-generation-queue";
import { MAX_PROJECT_MEDIA_RECOVERY_PASSES } from "@/lib/background-recovery-policy";

export const maxDuration = 300;

export const POST = handleCallback<ProjectMediaMessage>(async (message, metadata) => {
  try {
    await processProjectMediaScene(message, metadata.deliveryCount);
  } catch (error) {
    console.error(`[background-media] Scene ${message.sceneNumber} attempt ${metadata.deliveryCount} failed:`, error);
    const qualityRetriesExhausted = error instanceof ProjectMediaQualityExhaustedError
      && (
        metadata.deliveryCount >= 2
        || (message.recoveryPass ?? 0) >= MAX_PROJECT_MEDIA_RECOVERY_PASSES
      );
    const transientRetriesExhausted = metadata.deliveryCount >= 3;
    if (qualityRetriesExhausted || transientRetriesExhausted) {
      await permanentlyFailProjectMedia(message, error);
      return;
    }
    throw error;
  }
}, {
  visibilityTimeoutSeconds: 300,
  retry: (_error, metadata) => ({
    afterSeconds: Math.min(300, 15 * 2 ** Math.max(0, metadata.deliveryCount - 1))
  })
});
