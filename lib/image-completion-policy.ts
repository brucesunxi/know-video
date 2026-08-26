export type ImageCompletionFallbackReason =
  | "technical_only"
  | "text_detected"
  | "composition_duplicate"
  | "combined_text_disagreement"
  | "semantic_mismatch"
  | "text_free_nonduplicate"
  | "semantic_check_failed"
  | "style_mismatch"
  | "semantic_pass_style_unverified"
  | "semantic_pass_style_mismatch";

const IMAGE_COMPLETION_FALLBACK_SCORES: Record<ImageCompletionFallbackReason, number> = {
  technical_only: 10,
  text_detected: 15,
  composition_duplicate: 25,
  combined_text_disagreement: 35,
  semantic_mismatch: 45,
  text_free_nonduplicate: 50,
  semantic_check_failed: 55,
  style_mismatch: 70,
  semantic_pass_style_unverified: 85,
  semantic_pass_style_mismatch: 90
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
