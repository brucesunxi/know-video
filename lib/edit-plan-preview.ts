import { generateProjectSceneImages } from "@/lib/image-assets";
import { editPlanVisualSceneNumbers, planPreviewAsset } from "@/lib/edit-plan-preview-assets";
import { persistGeneratedSceneAssets } from "@/lib/project-mutations";
import type { EditPlan, Project } from "@/lib/types";
import { applyEditPlan } from "@/lib/video-brain";

export async function generateEditPlanVisualPreviews(project: Project, plan: EditPlan) {
  const targetSceneNumbers = editPlanVisualSceneNumbers(plan);
  if (targetSceneNumbers.length === 0) {
    throw new Error("这份修改方案不需要重新生成画面。");
  }

  const missingSceneNumbers = targetSceneNumbers.filter((sceneNumber) => {
    const scene = project.currentVersion.scenes.find((item) => item.sceneNumber === sceneNumber);
    return scene && !planPreviewAsset(scene, plan.id);
  });
  if (missingSceneNumbers.length === 0) return project;

  const proposed = applyEditPlan(project, plan);
  const previewProject: Project = {
    ...proposed,
    currentVersion: {
      ...proposed.currentVersion,
      id: project.currentVersion.id,
      label: project.currentVersion.label,
      status: project.currentVersion.status,
      createdAt: project.currentVersion.createdAt,
      renderUrl: project.currentVersion.renderUrl,
      renderJobId: project.currentVersion.renderJobId,
      assetStatus: project.currentVersion.assetStatus,
      assetErrorCode: project.currentVersion.assetErrorCode
    }
  };
  const previousKeys = new Set(previewProject.currentVersion.scenes.flatMap((scene) => (
    scene.assets.filter((asset) => asset.type === "thumbnail").map((asset) => asset.r2Key)
  )));
  const generated = await generateProjectSceneImages(previewProject, {
    candidate: true,
    replaceExistingImages: false,
    sceneNumbers: missingSceneNumbers,
    quality: "standard",
    variantKey: plan.id
  });
  const scenes = generated.currentVersion.scenes.map((scene) => ({
    ...scene,
    assets: scene.assets.map((asset) => (
      missingSceneNumbers.includes(scene.sceneNumber)
      && asset.type === "thumbnail"
      && asset.metadata?.candidate === true
      && !previousKeys.has(asset.r2Key)
        ? {
            ...asset,
            metadata: {
              ...asset.metadata,
              candidate: true,
              planPreview: true,
              editPlanId: plan.id,
              planSummary: plan.summary
            }
          }
        : asset
    ))
  }));
  const incomplete = missingSceneNumbers.filter((sceneNumber) => {
    const scene = scenes.find((item) => item.sceneNumber === sceneNumber);
    return !scene || !planPreviewAsset(scene, plan.id);
  });
  if (incomplete.length > 0) {
    throw new Error(`场景 ${incomplete.join("、")} 的修改预览生成失败，请稍后重试。`);
  }

  await persistGeneratedSceneAssets(project.currentVersion.id, scenes, {
    invalidateRender: false,
    sceneNumbers: missingSceneNumbers
  });

  return {
    ...project,
    currentVersion: {
      ...project.currentVersion,
      scenes: project.currentVersion.scenes.map((scene) => {
        const generatedScene = scenes.find((item) => item.sceneNumber === scene.sceneNumber);
        return generatedScene ? { ...scene, assets: generatedScene.assets } : scene;
      })
    }
  };
}
