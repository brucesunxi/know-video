import type { LocalMotionIntensity, LocalMotionPreset, Scene } from "@/lib/types";
import { styleAllowsFreeStockVideo } from "@/lib/style-motion-policy";

export type LocalMotionPlan = {
  preset: Exclude<LocalMotionPreset, "auto">;
  xFrom: number;
  xTo: number;
  yFrom: number;
  yTo: number;
  scaleFrom: number;
  scaleTo: number;
};

export type LocalMotionBeatTransition = "dissolve" | "slide-left" | "slide-right" | "slide-up" | "slide-down" | "zoom";

export type LocalMotionBeat = {
  index: number;
  startFrame: number;
  endFrame: number;
  transitionFrames: number;
  transition: LocalMotionBeatTransition;
  plan: LocalMotionPlan;
};

const AUTO_PRESETS: Array<LocalMotionPlan["preset"]> = [
  "push-in",
  "pan-left",
  "pull-out",
  "pan-right",
  "drift",
  "tilt-up"
];

function stableHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function inferredPreset(
  scene: Pick<Scene, "id" | "sceneNumber" | "motionPrompt" | "visualPrompt">,
  configuredSeed?: number
): LocalMotionPlan["preset"] {
  const direction = `${scene.motionPrompt} ${scene.visualPrompt}`.toLowerCase();
  if (/pan(?:s|ned|ning)?\s+(?:to\s+the\s+)?right|向右|右移|右摇/iu.test(direction)) return "pan-right";
  if (/pan(?:s|ned|ning)?\s+(?:to\s+the\s+)?left|向左|左移|左摇/iu.test(direction)) return "pan-left";
  if (/tilt(?:s|ed|ing)?\s+up|rise|upward|向上|上升|仰拍/iu.test(direction)) return "tilt-up";
  if (/tilt(?:s|ed|ing)?\s+down|descend|downward|向下|下降|俯拍/iu.test(direction)) return "tilt-down";
  if (/pull(?:s|ed|ing)?\s+(?:back|out)|zoom(?:s|ed|ing)?\s+out|reveal|拉远|后退|揭示全景/iu.test(direction)) return "pull-out";
  if (/push(?:es|ed|ing)?\s+(?:in|toward)|zoom(?:s|ed|ing)?\s+in|dolly\s+in|推进|推近|靠近/iu.test(direction)) return "push-in";
  if (/orbit|arc|parallax|环绕|弧线|视差/iu.test(direction)) return "drift";
  const seed = Number.isFinite(configuredSeed)
    ? Number(configuredSeed)
    : stableHash(`${scene.id}:${scene.sceneNumber}:${scene.motionPrompt}`);
  return AUTO_PRESETS[seed % AUTO_PRESETS.length];
}

function intensityFactor(intensity: LocalMotionIntensity, durationSeconds: number) {
  const base = intensity === "subtle" ? 0.72 : intensity === "dynamic" ? 1.18 : 1;
  const durationFactor = durationSeconds <= 3 ? 0.72 : durationSeconds <= 5 ? 0.88 : 1;
  return base * durationFactor;
}

const COMPLEMENTARY_PRESETS: Record<LocalMotionPlan["preset"], LocalMotionPlan["preset"][]> = {
  "push-in": ["pan-right", "pull-out", "pan-left"],
  "pull-out": ["pan-left", "push-in", "drift"],
  "pan-left": ["push-in", "tilt-up", "pull-out"],
  "pan-right": ["push-in", "tilt-down", "pull-out"],
  "tilt-up": ["pan-right", "push-in", "pull-out"],
  "tilt-down": ["pan-left", "push-in", "drift"],
  drift: ["push-in", "pan-right", "pull-out"]
};

const BEAT_TRANSITIONS: LocalMotionBeatTransition[] = [
  "dissolve",
  "slide-left",
  "zoom",
  "slide-right",
  "slide-up",
  "slide-down"
];

function planForPreset(input: {
  preset: LocalMotionPlan["preset"];
  factor: number;
  seed: number;
  shotScale?: number;
}): LocalMotionPlan {
  const { preset, factor, seed, shotScale = 0 } = input;
  const pan = 2.8 * factor;
  const tilt = 2.15 * factor;
  const zoom = 0.078 * factor;
  const baseScale = 1.035 + shotScale;
  const alternate = seed % 2 === 0 ? 1 : -1;

  if (preset === "push-in") return { preset, xFrom: -0.35 * alternate, xTo: 0.35 * alternate, yFrom: 0.2, yTo: -0.2, scaleFrom: baseScale, scaleTo: baseScale + zoom };
  if (preset === "pull-out") return { preset, xFrom: 0.35 * alternate, xTo: -0.35 * alternate, yFrom: -0.2, yTo: 0.2, scaleFrom: baseScale + zoom, scaleTo: baseScale };
  if (preset === "pan-left") return { preset, xFrom: pan, xTo: -pan, yFrom: 0, yTo: 0, scaleFrom: 1.075 + shotScale, scaleTo: 1.075 + shotScale + zoom * 0.22 };
  if (preset === "pan-right") return { preset, xFrom: -pan, xTo: pan, yFrom: 0, yTo: 0, scaleFrom: 1.075 + shotScale, scaleTo: 1.075 + shotScale + zoom * 0.22 };
  if (preset === "tilt-up") return { preset, xFrom: 0, xTo: 0, yFrom: tilt, yTo: -tilt, scaleFrom: 1.07 + shotScale, scaleTo: 1.07 + shotScale + zoom * 0.18 };
  if (preset === "tilt-down") return { preset, xFrom: 0, xTo: 0, yFrom: -tilt, yTo: tilt, scaleFrom: 1.07 + shotScale + zoom * 0.18, scaleTo: 1.07 + shotScale };
  return {
    preset,
    xFrom: 1.45 * factor * alternate,
    xTo: -1.45 * factor * alternate,
    yFrom: -0.8 * factor,
    yTo: 0.8 * factor,
    scaleFrom: 1.05 + shotScale,
    scaleTo: 1.05 + shotScale + zoom * 0.62
  };
}

export function localMotionPlan(scene: Pick<Scene, "id" | "sceneNumber" | "motionPrompt" | "visualPrompt" | "durationSeconds" | "style">): LocalMotionPlan {
  const configured = scene.style.motion?.preset ?? "auto";
  const preset = configured === "auto" ? inferredPreset(scene, scene.style.motion?.seed) : configured;
  const factor = intensityFactor(scene.style.motion?.intensity ?? "standard", scene.durationSeconds);
  const seed = Number.isFinite(scene.style.motion?.seed)
    ? Number(scene.style.motion?.seed)
    : stableHash(`${scene.id}:${scene.sceneNumber}`);
  return planForPreset({ preset, factor, seed });
}

export function localMotionSequence(
  scene: Pick<Scene, "id" | "sceneNumber" | "motionPrompt" | "visualPrompt" | "durationSeconds" | "style">,
  durationInFrames: number,
  fps: number
): LocalMotionBeat[] {
  const totalFrames = Math.max(1, Math.round(durationInFrames));
  const intensity = scene.style.motion?.intensity ?? "standard";
  const targetSeconds = intensity === "dynamic" ? 2.45 : intensity === "subtle" ? 4.1 : 3.25;
  const minimumBeatFrames = Math.max(1, Math.round(fps * 1.55));
  const maximumBeats = Math.max(1, Math.min(4, Math.floor(totalFrames / minimumBeatFrames)));
  const beatCount = Math.max(1, Math.min(maximumBeats, Math.round(totalFrames / Math.max(1, targetSeconds * fps))));
  const basePlan = localMotionPlan(scene);
  const seed = Number.isFinite(scene.style.motion?.seed)
    ? Number(scene.style.motion?.seed)
    : stableHash(`${scene.id}:${scene.sceneNumber}:sequence`);
  const alternatives = COMPLEMENTARY_PRESETS[basePlan.preset];
  const factor = intensityFactor(intensity, scene.durationSeconds);
  const baseFrames = Math.floor(totalFrames / beatCount);
  let cursor = 0;

  return Array.from({ length: beatCount }, (_, index) => {
    const length = index === beatCount - 1 ? totalFrames - cursor : baseFrames;
    const startFrame = cursor;
    const endFrame = Math.max(startFrame + 1, startFrame + length);
    cursor = endFrame;
    const preset = index === 0 ? basePlan.preset : alternatives[(seed + index - 1) % alternatives.length];
    const shotScale = index === 0 ? 0 : index % 3 === 1 ? 0.045 : index % 3 === 2 ? 0.085 : 0.025;
    const transitionFrames = index === 0
      ? 0
      : Math.min(Math.round(fps * 0.42), Math.max(2, Math.floor(length * 0.22)));
    return {
      index,
      startFrame,
      endFrame,
      transitionFrames,
      transition: BEAT_TRANSITIONS[(seed + index) % BEAT_TRANSITIONS.length],
      plan: planForPreset({ preset, factor, seed: seed + index, shotScale })
    };
  });
}

export function sceneUsesAiMotionClip(scene: Pick<Scene, "style" | "assets">) {
  if (scene.style.motion?.mode === "local") return false;
  const clip = scene.assets.find((asset) => asset.type === "clip" && Boolean(asset.url));
  if (!clip) return false;
  return clip.metadata?.source !== "free-stock-video" || styleAllowsFreeStockVideo(scene.style);
}
