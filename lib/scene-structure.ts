import type { Project, Scene, SceneAsset, SceneStructureMutation } from "@/lib/types";
import { mediaAssetStatus } from "@/lib/generation-resume";

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
    assetStatus: mediaAssetStatus(scenes),
    status: ready ? "ready" as const : "draft" as const
  };
}

function splitText(value: string) {
  const trimmed = value.trim();
  const candidates = Array.from(trimmed.matchAll(/[。！？!?；;，,]\s*/gu))
    .map((match) => (match.index ?? 0) + match[0].length)
    .filter((index) => index >= Math.floor(trimmed.length * 0.28) && index <= Math.ceil(trimmed.length * 0.72));
  const midpoint = trimmed.length / 2;
  const boundary = candidates.sort((left, right) => Math.abs(left - midpoint) - Math.abs(right - midpoint))[0]
    ?? Math.max(1, Math.round(midpoint));
  return [trimmed.slice(0, boundary).trim(), trimmed.slice(boundary).trim()] as const;
}

function splitTitle(title: string) {
  return /\p{Script=Han}/u.test(title)
    ? [`${title}（上）`, `${title}（下）`] as const
    : [`${title} · Part 1`, `${title} · Part 2`] as const;
}

export function sceneSplitPreview(scene: Pick<Scene, "title" | "voiceover" | "durationSeconds">) {
  const [firstVoiceover, secondVoiceover] = splitText(scene.voiceover);
  const [firstTitle, secondTitle] = splitTitle(scene.title);
  const firstWeight = firstVoiceover.replace(/\s/gu, "").length;
  const secondWeight = secondVoiceover.replace(/\s/gu, "").length;
  const totalWeight = Math.max(1, firstWeight + secondWeight);
  const firstDuration = Math.max(2, Math.min(scene.durationSeconds - 2, Math.round((scene.durationSeconds * firstWeight) / totalWeight)));
  return {
    first: { title: firstTitle, voiceover: firstVoiceover, durationSeconds: firstDuration },
    second: { title: secondTitle, voiceover: secondVoiceover, durationSeconds: scene.durationSeconds - firstDuration }
  };
}

function generatedMediaOnly(assets: SceneAsset[]) {
  return assets.filter((asset) => asset.type === "logo" || asset.type === "music");
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
  } else if (mutation.operation === "set-transition") {
    if (mutation.sceneNumber === 1) throw new Error("首个场景没有进入转场，请调整后续场景的转场。");
    if (!Number.isFinite(mutation.durationSeconds) || mutation.durationSeconds < 0 || mutation.durationSeconds > 1.2) {
      throw new Error("转场时长必须在 0 到 1.2 秒之间。");
    }
    const durationSeconds = mutation.kind === "cut" ? 0 : Math.max(0.2, mutation.durationSeconds);
    const current = scenes[index].style.transition ?? { kind: "auto" as const, durationSeconds: 0.5 };
    if (current.kind === mutation.kind && current.durationSeconds === durationSeconds) throw new Error("场景转场没有变化。");
    scenes[index] = {
      ...scenes[index],
      style: { ...scenes[index].style, transition: { kind: mutation.kind, durationSeconds } }
    };
    description = `场景 ${mutation.sceneNumber} 的进入转场已更新。`;
  } else if (mutation.operation === "set-visual") {
    const candidate = scenes[index].assets.find((asset) => (
      asset.id === mutation.assetId && asset.type === "thumbnail" && asset.metadata?.candidate === true
    ));
    if (!candidate) throw new Error("没有找到要采用的候选画面。");
    const previousImages = scenes[index].assets
      .filter((asset) => asset.type === "image")
      .map((asset) => ({
        ...asset,
        type: "thumbnail" as const,
        metadata: { ...asset.metadata, candidate: true, replacedAt: new Date().toISOString() }
      }));
    const selectedImage: SceneAsset = {
      ...candidate,
      type: "image",
      metadata: { ...candidate.metadata, candidate: false, adoptedAt: new Date().toISOString() }
    };
    scenes[index] = {
      ...scenes[index],
      assets: [
        selectedImage,
        ...scenes[index].assets.filter((asset) => (
          asset.id !== candidate.id && asset.type !== "image" && asset.type !== "clip"
        )),
        ...previousImages
      ]
    };
    description = `场景 ${mutation.sceneNumber} 已采用新的候选画面。`;
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
  } else if (mutation.operation === "split") {
    if (scenes.length >= 20) throw new Error("单个视频最多支持 20 个场景。");
    const source = scenes[index];
    if (source.durationSeconds < 4 || source.voiceover.trim().length < 8) {
      throw new Error("该场景内容过短，无法拆分为两个完整镜头。");
    }
    const split = sceneSplitPreview(source);
    const { voiceover: firstVoiceover, title: firstTitle, durationSeconds: firstDuration } = split.first;
    const { voiceover: secondVoiceover, title: secondTitle, durationSeconds: secondDuration } = split.second;
    if (!firstVoiceover || !secondVoiceover) throw new Error("该场景旁白缺少可用的拆分位置。");
    const retainedAssets = generatedMediaOnly(source.assets);
    scenes[index] = {
      ...source,
      title: firstTitle,
      voiceover: firstVoiceover,
      visualPrompt: `${source.visualPrompt}\nOpening beat: establish the first narrative idea with a distinct composition and clear visual focus.`,
      motionPrompt: `${source.motionPrompt} Resolve the movement at a natural midpoint for the next shot.`,
      durationSeconds: firstDuration,
      assets: retainedAssets
    };
    scenes.splice(index + 1, 0, {
      ...source,
      id: createId(),
      title: secondTitle,
      voiceover: secondVoiceover,
      visualPrompt: `${source.visualPrompt}\nContinuation beat: advance to the second narrative idea with a visibly different framing while preserving visual continuity.`,
      motionPrompt: `${source.motionPrompt} Begin from the previous shot's visual direction and complete the scene with a decisive ending.`,
      durationSeconds: secondDuration,
      assets: []
    });
    selectedSceneNumber = index + 2;
    description = `场景 ${mutation.sceneNumber} 已按旁白拆分为两个连续镜头。`;
  } else if (mutation.operation === "merge-next") {
    const source = scenes[index];
    const next = scenes[index + 1];
    if (!next) throw new Error("该场景没有后一场景可以合并。");
    const mergedDuration = source.durationSeconds + next.durationSeconds;
    if (mergedDuration > 20) throw new Error("合并后的场景超过 20 秒，请先缩短两个场景的时长。");
    const chinese = /\p{Script=Han}/u.test(source.title + next.title);
    scenes[index] = {
      ...source,
      title: chinese ? `${source.title}与${next.title}` : `${source.title} + ${next.title}`,
      voiceover: `${source.voiceover.trim()} ${next.voiceover.trim()}`.trim(),
      visualPrompt: `${source.visualPrompt}\nMerged continuation: ${next.visualPrompt}`,
      motionPrompt: `${source.motionPrompt} Continue seamlessly into: ${next.motionPrompt}`,
      durationSeconds: mergedDuration,
      assets: generatedMediaOnly(source.assets)
    };
    scenes.splice(index + 1, 1);
    selectedSceneNumber = index + 1;
    description = `场景 ${mutation.sceneNumber} 已与后一场景合并。`;
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
    regeneration: mutation.operation === "split"
      ? { imageSceneNumbers: [index + 1, index + 2], audioSceneNumbers: [index + 1, index + 2], clipSceneNumbers: [] }
      : mutation.operation === "merge-next"
        ? { imageSceneNumbers: [index + 1], audioSceneNumbers: [index + 1], clipSceneNumbers: [] }
        : { imageSceneNumbers: [], audioSceneNumbers: [], clipSceneNumbers: [] },
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
