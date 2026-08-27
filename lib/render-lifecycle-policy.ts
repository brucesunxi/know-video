import type { RenderJob } from "@/lib/types";

export const RENDER_JOB_QUEUED_TIMEOUT_MINUTES = 8;
export const RENDER_JOB_INACTIVITY_TIMEOUT_MINUTES = 20;
export const RENDER_JOB_MAX_RUNTIME_MINUTES = 50;
export const RENDER_JOB_WATCHDOG_INITIAL_DELAY_SECONDS = 10 * 60;
export const RENDER_JOB_WATCHDOG_RECHECK_DELAY_SECONDS = 10 * 60;

export function elapsedRenderJobMs(value?: string | Date, now = Date.now()) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : 0;
}

export function renderJobLooksStale(
  job: Pick<RenderJob, "status" | "createdAt" | "updatedAt">,
  now = Date.now()
) {
  if (job.status !== "queued" && job.status !== "running") return false;
  if (elapsedRenderJobMs(job.createdAt, now) >= RENDER_JOB_MAX_RUNTIME_MINUTES * 60_000) return true;
  const inactivityMinutes = job.status === "queued"
    ? RENDER_JOB_QUEUED_TIMEOUT_MINUTES
    : RENDER_JOB_INACTIVITY_TIMEOUT_MINUTES;
  return elapsedRenderJobMs(job.updatedAt, now) >= inactivityMinutes * 60_000;
}
