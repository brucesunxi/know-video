export type MediaGenerationProgress = {
  requestedSceneNumbers: number[];
  completedSceneNumbers: number[];
  failedSceneNumbers: number[];
};

function uniqueSceneNumbers(sceneNumbers: number[]) {
  return Array.from(new Set(sceneNumbers.filter((sceneNumber) => Number.isInteger(sceneNumber) && sceneNumber > 0)))
    .sort((left, right) => left - right);
}

export function mediaGenerationProgress(
  requestedSceneNumbers: number[],
  failedSceneNumbers: number[]
): MediaGenerationProgress {
  const requested = uniqueSceneNumbers(requestedSceneNumbers);
  const requestedSet = new Set(requested);
  const failed = uniqueSceneNumbers(failedSceneNumbers).filter((sceneNumber) => requestedSet.has(sceneNumber));
  const failedSet = new Set(failed);
  return {
    requestedSceneNumbers: requested,
    completedSceneNumbers: requested.filter((sceneNumber) => !failedSet.has(sceneNumber)),
    failedSceneNumbers: failed
  };
}

export function mediaGenerationFailureMessage(
  mediaLabel: string,
  progress: MediaGenerationProgress,
  reason: string
) {
  const failed = progress.failedSceneNumbers.join("、");
  if (progress.completedSceneNumbers.length === 0) {
    return `场景 ${failed} 的${mediaLabel}未完成。${reason}`;
  }
  return `场景 ${progress.completedSceneNumbers.join("、")} 已完成；场景 ${failed} 的${mediaLabel}未完成。${reason}`;
}
