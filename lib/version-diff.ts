import type { Scene, VersionChangeSummary } from "@/lib/types";

type SceneSnapshot = Pick<Scene, "sceneNumber" | "title" | "voiceover" | "visualPrompt" | "motionPrompt" | "durationSeconds" | "style">;

function comparable(scene: SceneSnapshot) {
  return JSON.stringify({
    title: scene.title,
    voiceover: scene.voiceover,
    visualPrompt: scene.visualPrompt,
    motionPrompt: scene.motionPrompt,
    durationSeconds: scene.durationSeconds,
    style: scene.style
  });
}

function sceneArray(value: unknown): SceneSnapshot[] {
  if (typeof value === "string") {
    try {
      return sceneArray(JSON.parse(value));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.filter((scene): scene is SceneSnapshot => Boolean(
    scene
    && typeof scene === "object"
    && typeof (scene as SceneSnapshot).sceneNumber === "number"
    && typeof (scene as SceneSnapshot).title === "string"
  ));
}

export function summarizeVersionChange(currentValue: unknown, parentValue: unknown): VersionChangeSummary {
  const current = sceneArray(currentValue).sort((left, right) => left.sceneNumber - right.sceneNumber);
  const parent = sceneArray(parentValue).sort((left, right) => left.sceneNumber - right.sceneNumber);
  const currentDuration = current.reduce((sum, scene) => sum + (Number(scene.durationSeconds) || 0), 0);
  const parentDuration = parent.reduce((sum, scene) => sum + (Number(scene.durationSeconds) || 0), 0);

  if (parent.length === 0) {
    return {
      changedScenes: 0,
      addedScenes: current.length,
      removedScenes: 0,
      durationDelta: currentDuration,
      description: "初始版本"
    };
  }

  const overlap = Math.min(current.length, parent.length);
  let changedScenes = 0;
  for (let index = 0; index < overlap; index += 1) {
    if (comparable(current[index]) !== comparable(parent[index])) changedScenes += 1;
  }
  const addedScenes = Math.max(0, current.length - parent.length);
  const removedScenes = Math.max(0, parent.length - current.length);
  const durationDelta = currentDuration - parentDuration;
  const parts: string[] = [];
  if (changedScenes > 0) parts.push(`修改 ${changedScenes} 个场景`);
  if (addedScenes > 0) parts.push(`新增 ${addedScenes} 个场景`);
  if (removedScenes > 0) parts.push(`删除 ${removedScenes} 个场景`);
  if (durationDelta !== 0) parts.push(`时长${durationDelta > 0 ? "+" : ""}${durationDelta} 秒`);

  return {
    changedScenes,
    addedScenes,
    removedScenes,
    durationDelta,
    description: parts.join(" · ") || "仅更新素材或成片设置"
  };
}
