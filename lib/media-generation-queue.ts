import { send } from "@vercel/queue";
import type { GenerationOptions } from "@/lib/types";

export const PROJECT_MEDIA_TOPIC = "project-media-generation";

export type ProjectMediaMessage = {
  requestId: string;
  userId: string;
  projectId: string;
  versionId: string;
  sceneNumber: number;
  engine: string;
  billingReservationKey?: string;
  options?: GenerationOptions;
  recoveryPass?: number;
  startedAt?: number;
};

export async function enqueueProjectMediaScene(message: ProjectMediaMessage) {
  return send(PROJECT_MEDIA_TOPIC, message, {
    idempotencyKey: `${message.requestId}:pass:${message.recoveryPass ?? 0}:scene:${message.sceneNumber}`,
    retentionSeconds: 7 * 24 * 60 * 60
  });
}
