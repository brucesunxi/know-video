export const MAX_PROJECT_MEDIA_RECOVERY_PASSES = 1;

export function backgroundImageAttemptPlan(input: {
  deliveryCount: number;
  recoveryPass?: number;
  requiresPremium: boolean;
}) {
  const deliveryCount = Math.max(1, Math.floor(input.deliveryCount));
  const recoveryPass = Math.max(0, Math.floor(input.recoveryPass ?? 0));
  const recoveryCycle = recoveryPass > 0;
  const completionRescue = deliveryCount >= 2 || recoveryCycle;
  return {
    completionRescue,
    recoveryCycle,
    requestedQuality: input.requiresPremium || completionRescue ? "premium" as const : "standard" as const,
    // The normal pass samples every scene once so one difficult frame cannot
    // hold the whole project. The single rescue pass gets one premium candidate
    // plus one stronger directed-recovery candidate.
    maxQualityAttempts: completionRescue ? 2 : 1,
    useStockContentGuide: completionRescue
  };
}

export function canContinueAfterSceneQualityFailure(_deliveryCount: number, _recoveryPass?: number) {
  // Quality rejections advance to the next scene immediately. Missing scenes
  // are revisited once with the stronger rescue plan after the first pass.
  return true;
}

export function nextProjectRecoveryPass(currentPass?: number) {
  return Math.max(0, Math.floor(currentPass ?? 0)) + 1;
}
