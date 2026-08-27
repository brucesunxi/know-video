import { send } from "@vercel/queue";
import {
  GENERATION_WATCHDOG_INITIAL_DELAY_SECONDS,
  GENERATION_WATCHDOG_RECHECK_DELAY_SECONDS
} from "@/lib/generation-lifecycle-policy";
import {
  RENDER_JOB_WATCHDOG_INITIAL_DELAY_SECONDS,
  RENDER_JOB_WATCHDOG_RECHECK_DELAY_SECONDS
} from "@/lib/render-lifecycle-policy";
import type { GenerationOptions } from "@/lib/types";

export const PROJECT_MEDIA_TOPIC = "project-media-generation";

export type ProjectMediaSceneMessage = {
  operation?: "scene";
  requestId: string;
  userId: string;
  projectId: string;
  versionId: string;
  sceneNumber: number;
  engine: string;
  billingReservationKey?: string;
  options?: GenerationOptions;
  recoveryPass?: number;
  resumeAttempt?: number;
  startedAt?: number;
};

export type ProjectGenerationWatchdogMessage = {
  operation: "watchdog";
  requestId: string;
  userId: string;
  billingReservationKey?: string;
  watchdogPass?: number;
};

export type RenderJobWatchdogMessage = {
  operation: "render-watchdog";
  jobId: string;
  projectId: string;
  versionId: string;
  watchdogPass?: number;
};

export type ProjectMediaMessage = ProjectMediaSceneMessage | ProjectGenerationWatchdogMessage | RenderJobWatchdogMessage;

export async function enqueueProjectMediaScene(message: ProjectMediaSceneMessage) {
  return send(PROJECT_MEDIA_TOPIC, message, {
    idempotencyKey: `${message.requestId}:resume:${message.resumeAttempt ?? 0}:pass:${message.recoveryPass ?? 0}:scene:${message.sceneNumber}`,
    retentionSeconds: 7 * 24 * 60 * 60
  });
}

export async function enqueueProjectGenerationWatchdog(message: ProjectGenerationWatchdogMessage) {
  const watchdogPass = message.watchdogPass ?? 0;
  return send(PROJECT_MEDIA_TOPIC, message, {
    idempotencyKey: `${message.requestId}:generation-watchdog:${watchdogPass}`,
    delaySeconds: watchdogPass > 0
      ? GENERATION_WATCHDOG_RECHECK_DELAY_SECONDS
      : GENERATION_WATCHDOG_INITIAL_DELAY_SECONDS,
    retentionSeconds: 7 * 24 * 60 * 60
  });
}

export async function enqueueRenderJobWatchdog(message: RenderJobWatchdogMessage) {
  const watchdogPass = message.watchdogPass ?? 0;
  return send(PROJECT_MEDIA_TOPIC, message, {
    idempotencyKey: `${message.jobId}:render-watchdog:${watchdogPass}`,
    delaySeconds: watchdogPass > 0
      ? RENDER_JOB_WATCHDOG_RECHECK_DELAY_SECONDS
      : RENDER_JOB_WATCHDOG_INITIAL_DELAY_SECONDS,
    retentionSeconds: 7 * 24 * 60 * 60
  });
}
