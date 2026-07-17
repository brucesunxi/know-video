import type { Project, SceneAsset } from "@/lib/types";

export type RenderInputAsset = {
  sceneNumber: number;
  role: "visual" | "audio";
  asset: SceneAsset;
};

export function renderInputAssets(project: Project) {
  return project.currentVersion.scenes.flatMap((scene): RenderInputAsset[] => {
    const clip = scene.assets.find((asset) => asset.type === "clip" && asset.url);
    const image = scene.assets.find((asset) => asset.type === "image" && asset.url);
    const audio = scene.assets.find((asset) => asset.type === "audio" && asset.url);
    return [
      ...(clip || image ? [{ sceneNumber: scene.sceneNumber, role: "visual" as const, asset: (clip || image)! }] : []),
      ...(audio ? [{ sceneNumber: scene.sceneNumber, role: "audio" as const, asset: audio }] : [])
    ];
  });
}

export function renderInputReadiness(project: Project) {
  const inputs = renderInputAssets(project);
  const visualScenes = new Set(inputs.filter((input) => input.role === "visual").map((input) => input.sceneNumber));
  const audioScenes = new Set(inputs.filter((input) => input.role === "audio").map((input) => input.sceneNumber));
  const missingVisuals = project.currentVersion.scenes
    .filter((scene) => !visualScenes.has(scene.sceneNumber))
    .map((scene) => scene.sceneNumber);
  const missingAudio = project.currentVersion.scenes
    .filter((scene) => !audioScenes.has(scene.sceneNumber))
    .map((scene) => scene.sceneNumber);
  const details = [
    missingVisuals.length > 0 ? `缺少画面的场景：${missingVisuals.join("、")}` : "",
    missingAudio.length > 0 ? `缺少配音的场景：${missingAudio.join("、")}` : ""
  ].filter(Boolean).join("；");

  return {
    inputs,
    missingVisuals,
    missingAudio,
    ready: project.currentVersion.scenes.length > 0 && missingVisuals.length === 0 && missingAudio.length === 0,
    error: project.currentVersion.scenes.length === 0
      ? "视频还没有可渲染的场景。"
      : details
        ? `视频素材尚未完整。${details}。`
        : undefined
  };
}

export function renderInputMetadataIssue(
  input: RenderInputAsset,
  metadata: { contentLength?: number; contentType?: string }
) {
  const minimumBytes = input.asset.type === "clip" ? 10_000 : input.role === "audio" ? 2_000 : 1_000;
  if (!metadata.contentLength || metadata.contentLength < minimumBytes) return "文件大小异常";
  const contentType = metadata.contentType?.toLowerCase() ?? "";
  if (input.role === "audio" && !contentType.startsWith("audio/")) return "不是有效音频";
  if (input.asset.type === "clip" && !contentType.startsWith("video/")) return "不是有效视频";
  if (input.asset.type === "image" && !contentType.startsWith("image/")) return "不是有效图片";
  return undefined;
}
