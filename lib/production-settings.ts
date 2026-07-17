import type { PlaybackRate, ProductionSettings, Project, ProjectVersion, Scene, SceneAsset } from "@/lib/types";

export const DEFAULT_PRODUCTION_SETTINGS: ProductionSettings = {
  captionsEnabled: true,
  captionStyle: "boxed",
  playbackRate: 1,
  musicVolume: 0.12,
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

export function productionDurationInFrames(version: ProjectVersion, fps: number) {
  const playbackRate: PlaybackRate = productionSettingsFromScenes(version.scenes).playbackRate;
  return Math.max(1, Math.round((version.durationSeconds * fps) / playbackRate));
}

export function productionDurationSeconds(version: ProjectVersion) {
  return version.durationSeconds / productionSettingsFromScenes(version.scenes).playbackRate;
}
