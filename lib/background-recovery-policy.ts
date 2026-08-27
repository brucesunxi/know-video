export const MAX_PROJECT_MEDIA_RECOVERY_PASSES = 2;

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
    // Normal delivery tries two fast candidates. Rescue tries one premium
    // candidate and one stronger directed-recovery candidate in the same cap.
    maxQualityAttempts: 2,
    useStockContentGuide: completionRescue
  };
}

export function canContinueAfterSceneQualityFailure(deliveryCount: number, recoveryPass?: number) {
  // The initial delivery gets one queue retry. A directed project-recovery pass
  // has already escalated its strategy, so it can advance after one delivery.
  return deliveryCount >= 2 || (recoveryPass ?? 0) > 0;
}

export function nextProjectRecoveryPass(currentPass?: number) {
  return Math.max(0, Math.floor(currentPass ?? 0)) + 1;
}
