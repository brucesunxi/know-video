export const GENERATION_PLANNING_TIMEOUT_MINUTES = 15;
export const GENERATION_MEDIA_INACTIVITY_MINUTES = 8;
export const GENERATION_MAX_RUNTIME_MINUTES = 40;
export const GENERATION_WATCHDOG_INITIAL_DELAY_SECONDS = 12 * 60;
export const GENERATION_WATCHDOG_RECHECK_DELAY_SECONDS = 8 * 60;

export function elapsedGenerationMs(value: string | Date, now = Date.now()) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : 0;
}

export function generationMediaIsInactive(updatedAt: string | Date, now = Date.now()) {
  return elapsedGenerationMs(updatedAt, now) >= GENERATION_MEDIA_INACTIVITY_MINUTES * 60_000;
}

export function generationExceededRuntime(createdAt: string | Date, now = Date.now()) {
  return elapsedGenerationMs(createdAt, now) >= GENERATION_MAX_RUNTIME_MINUTES * 60_000;
}

export function generationResumeAttempt(createdAt: string | Date, now = Date.now()) {
  const intervalMs = GENERATION_MEDIA_INACTIVITY_MINUTES * 60_000;
  return Math.max(1, Math.floor(elapsedGenerationMs(createdAt, now) / intervalMs));
}
