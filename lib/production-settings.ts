import type { PlaybackRate, ProductionSettings, Project, ProjectVersion, Scene, SceneAsset } from "@/lib/types";

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

  // Keep scene changes responsive without cutting off the final syllable.
  // The last scene gets a slightly longer finish before the video ends.
  const holdSeconds = isLastScene ? 0.8 : 0.4;
  const pacedDuration = Math.ceil((narrationEnd + holdSeconds) * 10) / 10;
  return Math.max(narrationEnd + 0.1, Math.min(plannedDuration, pacedDuration));
}

export function effectiveVersionDurationSeconds(version: ProjectVersion) {
  if (
    version.scenes.length === 0
    || version.scenes.some((scene) => !Number.isFinite(Number(scene.durationSeconds)) || Number(scene.durationSeconds) <= 0)
  ) {
    return Math.max(0.1, version.durationSeconds);
  }
  return version.scenes.reduce((total, scene, index) => (
    total + effectiveSceneDurationSeconds(scene, index === version.scenes.length - 1)
  ), 0);
}

export function productionDurationInFrames(version: ProjectVersion, fps: number) {
  const playbackRate: PlaybackRate = productionSettingsFromScenes(version.scenes).playbackRate;
  return Math.max(1, Math.round((effectiveVersionDurationSeconds(version) * fps) / playbackRate));
}

export function productionDurationSeconds(version: ProjectVersion) {
  return effectiveVersionDurationSeconds(version) / productionSettingsFromScenes(version.scenes).playbackRate;
}
