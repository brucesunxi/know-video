import { handleCallback } from "@vercel/queue";
import {
  permanentlyFailProjectGenerationWatchdog,
  permanentlyFailProjectMedia,
  ProjectMediaQualityExhaustedError,
  processProjectGenerationWatchdog,
  processProjectMediaScene
} from "@/lib/background-media-generation";
import type { ProjectMediaMessage } from "@/lib/media-generation-queue";
import { MAX_PROJECT_MEDIA_RECOVERY_PASSES } from "@/lib/background-recovery-policy";
import { permanentlyFailRenderWatchdog, processRenderJobWatchdog } from "@/lib/render-watchdog";

export const maxDuration = 300;

export const POST = handleCallback<ProjectMediaMessage>(async (message, metadata) => {
  if (message.operation === "render-watchdog") {
    try {
      await processRenderJobWatchdog(message);
    } catch (error) {
      console.error(`[render-watchdog] Attempt ${metadata.deliveryCount} failed:`, error);
      if (metadata.deliveryCount >= 3) {
        await permanentlyFailRenderWatchdog(message);
        return;
      }
      throw error;
    }
    return;
  }
  if (message.operation === "watchdog") {
    try {
      await processProjectGenerationWatchdog(message);
    } catch (error) {
      console.error(`[background-media] Generation watchdog attempt ${metadata.deliveryCount} failed:`, error);
      if (metadata.deliveryCount >= 3) {
        await permanentlyFailProjectGenerationWatchdog(message, error);
        return;
      }
      throw error;
    }
    return;
  }
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
