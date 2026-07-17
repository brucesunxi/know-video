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
