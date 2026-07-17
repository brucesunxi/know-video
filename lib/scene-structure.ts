import type { Project, Scene, SceneAsset, SceneStructureMutation } from "@/lib/types";

export type { SceneStructureMutation } from "@/lib/types";

function withoutProduction(scene: Scene) {
  const { production: _production, ...style } = scene.style;
  return {
    ...scene,
    style,
    assets: scene.assets.filter((asset) => asset.type !== "logo" && asset.type !== "music")
  };
}

function mediaStatus(scenes: Scene[]) {
  const visualCount = scenes.filter((scene) => scene.assets.some((asset) => asset.type === "image" || asset.type === "clip")).length;
  const audioCount = scenes.filter((scene) => scene.assets.some((asset) => asset.type === "audio")).length;
  const ready = scenes.length > 0 && visualCount === scenes.length && audioCount === scenes.length;
  return {
    assetStatus: visualCount === scenes.length ? "ready" as const : visualCount > 0 ? "partial" as const : "failed" as const,
    status: ready ? "ready" as const : "draft" as const
  };
}

export function applySceneStructureMutation(
  project: Project,
  mutation: SceneStructureMutation,
  createId: () => string = crypto.randomUUID
) {
  const original = [...project.currentVersion.scenes].sort((left, right) => left.sceneNumber - right.sceneNumber);
  const index = original.findIndex((scene) => scene.sceneNumber === mutation.sceneNumber);
  if (index < 0) throw new Error("没有找到要调整的场景。");

  const production = original[0]?.style.production;
  const productionAssets: SceneAsset[] = original[0]?.assets.filter((asset) => asset.type === "logo" || asset.type === "music") ?? [];
  const scenes = original.map(withoutProduction);
  let selectedSceneNumber = mutation.sceneNumber;
  let description = "";

  if (mutation.operation === "set-duration") {
    if (!Number.isInteger(mutation.durationSeconds) || mutation.durationSeconds < 2 || mutation.durationSeconds > 20) {
      throw new Error("单个场景时长必须是 2 到 20 秒的整数。");
    }
    if (scenes[index].durationSeconds === mutation.durationSeconds) throw new Error("场景时长没有变化。");
    scenes[index] = { ...scenes[index], durationSeconds: mutation.durationSeconds };
    description = `场景 ${mutation.sceneNumber} 已调整为 ${mutation.durationSeconds} 秒。`;
  } else if (mutation.operation === "move") {
    const target = mutation.direction === "earlier" ? index - 1 : index + 1;
    if (target < 0 || target >= scenes.length) throw new Error("该场景已经位于时间线边界。");
    [scenes[index], scenes[target]] = [scenes[target], scenes[index]];
    selectedSceneNumber = target + 1;
    description = `场景已向${mutation.direction === "earlier" ? "前" : "后"}移动一位。`;
  } else if (mutation.operation === "move-to") {
    if (!Number.isInteger(mutation.targetSceneNumber) || mutation.targetSceneNumber < 1 || mutation.targetSceneNumber > scenes.length) {
      throw new Error("目标位置超出了当前时间线范围。");
    }
    if (mutation.targetSceneNumber === mutation.sceneNumber) throw new Error("场景位置没有变化。");
    const [moved] = scenes.splice(index, 1);
    scenes.splice(mutation.targetSceneNumber - 1, 0, moved);
    selectedSceneNumber = mutation.targetSceneNumber;
    description = `场景 ${mutation.sceneNumber} 已移动到第 ${mutation.targetSceneNumber} 位。`;
  } else if (mutation.operation === "duplicate") {
    if (scenes.length >= 20) throw new Error("单个视频最多支持 20 个场景。");
    const source = scenes[index];
    const copy: Scene = {
      ...source,
      id: createId(),
      title: `${source.title} 副本`,
      assets: source.assets.map((asset) => ({ ...asset, id: createId() }))
    };
    scenes.splice(index + 1, 0, copy);
    selectedSceneNumber = index + 2;
    description = `场景 ${mutation.sceneNumber} 已复制到下一位置。`;
  } else {
    if (scenes.length <= 1) throw new Error("视频至少需要保留一个场景。");
    scenes.splice(index, 1);
    selectedSceneNumber = Math.min(index + 1, scenes.length);
    description = `场景 ${mutation.sceneNumber} 已从当前版本删除。`;
  }

  const normalizedScenes = scenes.map((scene, sceneIndex) => ({
    ...scene,
    sceneNumber: sceneIndex + 1,
    style: sceneIndex === 0 && production ? { ...scene.style, production } : scene.style,
    assets: sceneIndex === 0 ? [...productionAssets, ...scene.assets] : scene.assets
  }));
  const status = mediaStatus(normalizedScenes);
  const versionId = createId();

  return {
    description,
    selectedSceneNumber,
    project: {
      ...project,
      currentVersion: {
        ...project.currentVersion,
        id: versionId,
        parentVersionId: project.currentVersion.id,
        label: "时间线调整",
        status: status.status,
        assetStatus: status.assetStatus,
        assetErrorCode: undefined,
        createdAt: new Date().toISOString(),
        durationSeconds: normalizedScenes.reduce((sum, scene) => sum + scene.durationSeconds, 0),
        renderUrl: undefined,
        renderJobId: undefined,
        scenes: normalizedScenes
      }
    } satisfies Project
  };
}
