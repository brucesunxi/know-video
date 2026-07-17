import type { MusicDucking } from "@/lib/types";

export type NarrationFrameRange = { startFrame: number; endFrame: number };

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function mix(from: number, to: number, progress: number) {
  const eased = clamp01(progress);
  return from + (to - from) * eased;
}

function duckingTarget(mode: MusicDucking) {
  if (mode === "strong") return 0.2;
  if (mode === "balanced") return 0.38;
  return 1;
}

export function musicMixEnvelope(input: {
  frame: number;
  totalFrames: number;
  narrationRanges: NarrationFrameRange[];
  ducking: MusicDucking;
  fadeInFrames?: number;
  fadeOutFrames?: number;
  attackFrames?: number;
  releaseFrames?: number;
}) {
  const frame = Math.max(0, input.frame);
  const totalFrames = Math.max(1, input.totalFrames);
  const fadeInFrames = Math.max(1, input.fadeInFrames ?? 18);
  const fadeOutFrames = Math.max(1, input.fadeOutFrames ?? 24);
  const attackFrames = Math.max(1, input.attackFrames ?? 6);
  const releaseFrames = Math.max(1, input.releaseFrames ?? 12);
  const fadeIn = clamp01(frame / fadeInFrames);
  const fadeOut = clamp01((totalFrames - 1 - frame) / fadeOutFrames);
  const target = duckingTarget(input.ducking);
  let ducking = 1;

  if (target < 1) {
    for (const range of input.narrationRanges) {
      const start = Math.max(0, range.startFrame);
      const end = Math.max(start, range.endFrame);
      if (frame < start - attackFrames || frame > end + releaseFrames) continue;
      const candidate = frame < start
        ? mix(1, target, (frame - (start - attackFrames)) / attackFrames)
        : frame <= end
          ? target
          : mix(target, 1, (frame - end) / releaseFrames);
      ducking = Math.min(ducking, candidate);
    }
  }

  return clamp01(Math.min(fadeIn, fadeOut) * ducking);
}
