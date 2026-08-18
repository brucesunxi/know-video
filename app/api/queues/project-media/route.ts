import { handleCallback } from "@vercel/queue";
import {
  permanentlyFailProjectMedia,
  processProjectMediaScene
} from "@/lib/background-media-generation";
import type { ProjectMediaMessage } from "@/lib/media-generation-queue";

export const maxDuration = 300;

export const POST = handleCallback<ProjectMediaMessage>(async (message, metadata) => {
  try {
    await processProjectMediaScene(message);
  } catch (error) {
    console.error(`[background-media] Scene ${message.sceneNumber} attempt ${metadata.deliveryCount} failed:`, error);
    if (metadata.deliveryCount >= 6) {
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
