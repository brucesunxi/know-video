import type { PlaybackRate, ProductionSettings, Project, ProjectVersion, Scene, SceneAsset } from "@/lib/types";
import { boundedTransitionFrames } from "@/lib/scene-transitions";

export const DEFAULT_PRODUCTION_SETTINGS: ProductionSettings = {
  captionsEnabled: true,
  captionStyle: "boxed",
  playbackRate: 1,
  musicVolume: 0.12,
  musicDucking: "balanced",
  logoPosition: "top-right",
  logoSize: 12
};

function boundedNumber(value: unknown, minimum: number, maximum: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

export function productionSettingsFromScenes(scenes: Scene[]): ProductionSettings {
  const stored = scenes[0]?.style.production;
  const captionStyle = ["minimal", "boxed", "highlight"].includes(String(stored?.captionStyle))
    ? stored?.captionStyle as ProductionSettings["captionStyle"]
    : DEFAULT_PRODUCTION_SETTINGS.captionStyle;
  const playbackRate = [0.75, 1, 1.25, 1.5].includes(Number(stored?.playbackRate))
    ? Number(stored?.playbackRate) as PlaybackRate
    : DEFAULT_PRODUCTION_SETTINGS.playbackRate;
  const logoPosition = ["top-left", "top-right", "bottom-left", "bottom-right"].includes(String(stored?.logoPosition))
    ? stored?.logoPosition as ProductionSettings["logoPosition"]
    : DEFAULT_PRODUCTION_SETTINGS.logoPosition;
  return {
    ...DEFAULT_PRODUCTION_SETTINGS,
    ...stored,
    captionsEnabled: typeof stored?.captionsEnabled === "boolean" ? stored.captionsEnabled : DEFAULT_PRODUCTION_SETTINGS.captionsEnabled,
    captionStyle,
    playbackRate,
    musicVolume: boundedNumber(stored?.musicVolume, 0, 0.5, DEFAULT_PRODUCTION_SETTINGS.musicVolume),
    musicDucking: ["off", "balanced", "strong"].includes(String(stored?.musicDucking))
      ? stored?.musicDucking as ProductionSettings["musicDucking"]
      : DEFAULT_PRODUCTION_SETTINGS.musicDucking,
    logoPosition,
    logoSize: boundedNumber(stored?.logoSize, 6, 24, DEFAULT_PRODUCTION_SETTINGS.logoSize)
  };
}

export function productionSettings(project: Project) {
  return productionSettingsFromScenes(project.currentVersion.scenes);
}

export function productionAsset(project: Project, type: "logo" | "music"): SceneAsset | undefined {
  return project.currentVersion.scenes
    .flatMap((scene) => scene.assets)
    .find((asset) => asset.type === type && asset.url);
}

function positiveMetadataNumber(asset: SceneAsset | undefined, key: string) {
  const value = Number(asset?.metadata?.[key]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function effectiveSceneDurationSeconds(scene: Scene, isLastScene = false) {
  const plannedDuration = Math.max(0.1, Number(scene.durationSeconds) || 0.1);
  const narration = scene.assets?.find((asset) => asset.type === "audio" && asset.url);
  if (!narration) return plannedDuration;

  const audibleEnd = positiveMetadataNumber(narration, "audibleEndSeconds");
  const audioDuration = positiveMetadataNumber(narration, "actualDurationSeconds");
  const narrationEnd = audibleEnd ?? audioDuration;
  if (!narrationEnd) return plannedDuration;

  // Cut promptly once speech ends. Keep only a tiny buffer for the last syllable
  // so scene switches feel brisk instead of lingering between beats.
  const holdSeconds = isLastScene ? 0.16 : 0.08;
  const pacedDuration = Math.ceil((narrationEnd + holdSeconds) * 100) / 100;
  return Math.max(narrationEnd + 0.08, Math.min(plannedDuration, pacedDuration));
}

export function productionSceneTimeline(version: ProjectVersion, fps: number) {
  const playbackRate: PlaybackRate = productionSettingsFromScenes(version.scenes).playbackRate;
  const fallbackTotalFrames = Math.max(1, Math.round((Math.max(0.1, version.durationSeconds) * fps) / playbackRate));
  if (
    version.scenes.length === 0
    || version.scenes.some((scene) => !Number.isFinite(Number(scene.durationSeconds)) || Number(scene.durationSeconds) <= 0)
  ) {
    return {
      sceneFrames: [],
      transitionFrames: [],
      sceneStartFrames: [],
      totalFrames: fallbackTotalFrames
    };
  }
  const sceneFrames = version.scenes.map((scene, index, scenes) => (
    Math.max(1, Math.round((
      effectiveSceneDurationSeconds(scene, index === scenes.length - 1) * fps
    ) / playbackRate))
  ));
  const transitionFrames = version.scenes.map((scene, index) => index === 0
    ? 0
    : boundedTransitionFrames({
      scene,
      fps,
      previousSceneFrames: sceneFrames[index - 1],
      sceneFrames: sceneFrames[index]
    }));
  const sceneStartFrames = sceneFrames.map((_, index) => {
    if (index === 0) return 0;
    const elapsed = sceneFrames.slice(0, index).reduce((sum, frames) => sum + frames, 0);
    const overlap = transitionFrames.slice(0, index + 1).reduce((sum, frames) => sum + frames, 0);
    return Math.max(0, elapsed - overlap);
  });
  const totalFrames = Math.max(1, sceneStartFrames[sceneStartFrames.length - 1] + sceneFrames[sceneFrames.length - 1]);
  return { sceneFrames, transitionFrames, sceneStartFrames, totalFrames };
}

export function effectiveVersionDurationSeconds(version: ProjectVersion) {
  if (
    version.scenes.length === 0
    || version.scenes.some((scene) => !Number.isFinite(Number(scene.durationSeconds)) || Number(scene.durationSeconds) <= 0)
  ) {
    return Math.max(0.1, version.durationSeconds);
  }
  const duration = version.scenes.reduce((total, scene, index) => (
    total + effectiveSceneDurationSeconds(scene, index === version.scenes.length - 1)
  ), 0);
  const transitionOverlapSeconds = version.scenes.reduce((total, scene, index, scenes) => {
    if (index === 0) return total;
    const previousDuration = effectiveSceneDurationSeconds(scenes[index - 1], false);
    const sceneDuration = effectiveSceneDurationSeconds(scene, index === scenes.length - 1);
    return total + (
      boundedTransitionFrames({
        scene,
        fps: 100,
        previousSceneFrames: Math.round(previousDuration * 100),
        sceneFrames: Math.round(sceneDuration * 100)
      }) / 100
    );
  }, 0);
  return Math.max(0.1, duration - transitionOverlapSeconds);
}

export function productionDurationInFrames(version: ProjectVersion, fps: number) {
  return productionSceneTimeline(version, fps).totalFrames;
}

export function productionDurationSeconds(version: ProjectVersion) {
  return effectiveVersionDurationSeconds(version) / productionSettingsFromScenes(version.scenes).playbackRate;
}
