export type ImageCompletionFallbackReason =
  | "semantic_mismatch"
  | "semantic_check_failed"
  | "style_mismatch";

const IMAGE_COMPLETION_FALLBACK_SCORES: Record<ImageCompletionFallbackReason, number> = {
  semantic_mismatch: 45,
  semantic_check_failed: 55,
  style_mismatch: 70
};

export function imageCompletionFallbackScore(reason: ImageCompletionFallbackReason) {
  return IMAGE_COMPLETION_FALLBACK_SCORES[reason];
}

export function shouldUseImageCompletionFallback(
  current: { seed: number; prompt: string; score: number } | undefined,
  candidate: { seed: number; prompt: string; score: number }
) {
  if (!current) return true;
  const updatesSameCandidate = current.seed === candidate.seed && current.prompt === candidate.prompt;
  return updatesSameCandidate || candidate.score > current.score;
}
