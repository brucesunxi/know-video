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

export type LocalMotionBeatTransition = "dissolve" | "slide-left" | "slide-right" | "slide-up" | "slide-down" | "zoom" | "paper-swap";

export type LocalMotionBeat = {
  index: number;
  startFrame: number;
  endFrame: number;
  transitionFrames: number;
  transition: LocalMotionBeatTransition;
  treatment: "cinematic" | "graphic";
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

const GRAPHIC_BEAT_TRANSITIONS: LocalMotionBeatTransition[] = [
  "paper-swap",
  "slide-left",
  "zoom",
  "paper-swap",
  "slide-right",
  "dissolve"
];

function motionTreatment(style: Pick<Scene["style"], "visualStyleId" | "visualStyleLabel" | "visualStylePrompt" | "theme" | "mood">) {
  return styleAllowsFreeStockVideo(style as Scene["style"]) ? "cinematic" as const : "graphic" as const;
}

function planForPreset(input: {
  preset: LocalMotionPlan["preset"];
  factor: number;
  seed: number;
  shotScale?: number;
}): LocalMotionPlan {
  const { preset, factor, seed, shotScale = 0 } = input;
  const pan = 4.25 * factor;
  const tilt = 3.25 * factor;
  const zoom = 0.105 * factor;
  const baseScale = 1.01 + shotScale;
  const alternate = seed % 2 === 0 ? 1 : -1;

  if (preset === "push-in") return { preset, xFrom: -0.7 * alternate, xTo: 0.7 * alternate, yFrom: 0.45, yTo: -0.45, scaleFrom: baseScale, scaleTo: baseScale + zoom };
  if (preset === "pull-out") return { preset, xFrom: 0.7 * alternate, xTo: -0.7 * alternate, yFrom: -0.45, yTo: 0.45, scaleFrom: baseScale + zoom, scaleTo: baseScale };
  if (preset === "pan-left") return { preset, xFrom: pan, xTo: -pan, yFrom: 0.35 * alternate, yTo: -0.35 * alternate, scaleFrom: 1.045 + shotScale, scaleTo: 1.045 + shotScale + zoom * 0.28 };
  if (preset === "pan-right") return { preset, xFrom: -pan, xTo: pan, yFrom: -0.35 * alternate, yTo: 0.35 * alternate, scaleFrom: 1.045 + shotScale, scaleTo: 1.045 + shotScale + zoom * 0.28 };
  if (preset === "tilt-up") return { preset, xFrom: 0.35 * alternate, xTo: -0.35 * alternate, yFrom: tilt, yTo: -tilt, scaleFrom: 1.04 + shotScale, scaleTo: 1.04 + shotScale + zoom * 0.24 };
  if (preset === "tilt-down") return { preset, xFrom: -0.35 * alternate, xTo: 0.35 * alternate, yFrom: -tilt, yTo: tilt, scaleFrom: 1.04 + shotScale + zoom * 0.24, scaleTo: 1.04 + shotScale };
  return {
    preset,
    xFrom: 2.8 * factor * alternate,
    xTo: -2.8 * factor * alternate,
    yFrom: -1.6 * factor,
    yTo: 1.6 * factor,
    scaleFrom: 1.025 + shotScale,
    scaleTo: 1.025 + shotScale + zoom * 0.72
  };
}

export function localMotionPlan(scene: Pick<Scene, "id" | "sceneNumber" | "motionPrompt" | "visualPrompt" | "durationSeconds" | "style">): LocalMotionPlan {
  const configured = scene.style.motion?.preset ?? "auto";
  const preset = configured === "auto" ? inferredPreset(scene, scene.style.motion?.seed) : configured;
  const treatment = motionTreatment(scene.style);
  const styleFactor = treatment === "graphic" ? 1.28 : 1;
  const factor = intensityFactor(scene.style.motion?.intensity ?? "standard", scene.durationSeconds) * styleFactor;
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
  const treatment = motionTreatment(scene.style);
  const targetSeconds = treatment === "graphic"
    ? intensity === "dynamic" ? 3.2 : intensity === "subtle" ? 6.5 : 4.8
    : intensity === "dynamic" ? 3.6 : intensity === "subtle" ? 7.2 : 5.4;
  const minimumBeatFrames = Math.max(1, Math.round(fps * (treatment === "graphic" ? 2.6 : 3)));
  const maximumBeats = Math.max(1, Math.min(4, Math.floor(totalFrames / minimumBeatFrames)));
  const beatCount = Math.max(1, Math.min(maximumBeats, Math.round(totalFrames / Math.max(1, targetSeconds * fps))));
  const basePlan = localMotionPlan(scene);
  const seed = Number.isFinite(scene.style.motion?.seed)
    ? Number(scene.style.motion?.seed)
    : stableHash(`${scene.id}:${scene.sceneNumber}:sequence`);
  const alternatives = COMPLEMENTARY_PRESETS[basePlan.preset];
  const factor = intensityFactor(intensity, scene.durationSeconds) * (treatment === "graphic" ? 1.28 : 1);
  const baseFrames = Math.floor(totalFrames / beatCount);
  let cursor = 0;

  return Array.from({ length: beatCount }, (_, index) => {
    const length = index === beatCount - 1 ? totalFrames - cursor : baseFrames;
    const startFrame = cursor;
    const endFrame = Math.max(startFrame + 1, startFrame + length);
    cursor = endFrame;
    const preset = index === 0 ? basePlan.preset : alternatives[(seed + index - 1) % alternatives.length];
    const shotScale = index === 0
      ? 0
      : treatment === "graphic"
        ? index % 3 === 1 ? 0.045 : index % 3 === 2 ? 0.075 : 0.025
        : index % 3 === 1 ? 0.03 : index % 3 === 2 ? 0.055 : 0.018;
    const transitionFrames = index === 0
      ? 0
      : Math.min(Math.round(fps * (treatment === "graphic" ? 0.38 : 0.32)), Math.max(2, Math.floor(length * 0.16)));
    const transitions = treatment === "graphic" ? GRAPHIC_BEAT_TRANSITIONS : BEAT_TRANSITIONS;
    return {
      index,
      startFrame,
      endFrame,
      transitionFrames,
      transition: transitions[(seed + index) % transitions.length],
      treatment,
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
