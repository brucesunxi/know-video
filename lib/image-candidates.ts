import { generateProjectSceneImages } from "@/lib/image-assets";
import { persistGeneratedSceneAssets } from "@/lib/project-mutations";
import type { Project, SceneAsset } from "@/lib/types";

export class CandidateImageError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function generateSceneImageCandidate(
  project: Project,
  input: { sceneNumber: number; instruction?: string; quality: "standard" | "premium" }
): Promise<{ project: Project; candidate: SceneAsset }> {
  const scene = project.currentVersion.scenes.find((item) => item.sceneNumber === input.sceneNumber);
  if (!scene) throw new CandidateImageError("没有找到要生成候选画面的场景。", 404);
  if (!scene.assets.some((asset) => asset.type === "image" && asset.url)) {
    throw new CandidateImageError("请先生成当前场景画面，再创建视觉候选。", 409);
  }
  const candidates = scene.assets.filter((asset) => asset.type === "thumbnail" && asset.metadata?.candidate === true);
  if (candidates.length >= 3) {
    throw new CandidateImageError("每个场景最多保留 3 张候选画面，请先移除不需要的候选。", 409);
  }

  const previousKeys = new Set(candidates.map((asset) => asset.r2Key));
  const updated = await generateProjectSceneImages(project, {
    candidate: true,
    quality: input.quality,
    replaceExistingImages: false,
    sceneNumbers: [input.sceneNumber],
    variantKey: crypto.randomUUID(),
    visualInstruction: input.instruction
  });
  const updatedScene = updated.currentVersion.scenes.find((item) => item.sceneNumber === input.sceneNumber);
  const candidate = updatedScene?.assets.find((asset) => (
    asset.type === "thumbnail" && asset.metadata?.candidate === true && !previousKeys.has(asset.r2Key)
  ));
  if (!candidate) throw new CandidateImageError("候选画面没有生成成功，请稍后重试。", 502);

  await persistGeneratedSceneAssets(updated.currentVersion.id, updated.currentVersion.scenes, {
    invalidateRender: false,
    sceneNumbers: [input.sceneNumber]
  });
  return { project: updated, candidate };
}
