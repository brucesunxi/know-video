import type { EditPlan, Project, Scene, SceneAsset } from "@/lib/types";

const VISUAL_ASSET_TYPES = new Set(["image", "thumbnail"]);

export function editPlanVisualSceneNumbers(plan: EditPlan) {
  return Array.from(new Set(plan.changes
    .filter((change) => change.status !== "deleted" && change.regenerate.some((type) => VISUAL_ASSET_TYPES.has(type)))
    .map((change) => change.sceneNumber)));
}

export function planPreviewAsset(scene: Scene, editPlanId: string) {
  return scene.assets.find((asset) => (
    asset.type === "thumbnail"
    && asset.metadata?.candidate === true
    && asset.metadata?.planPreview === true
    && asset.metadata?.editPlanId === editPlanId
  ));
}

export function promoteEditPlanPreviewAssets(project: Project, plan: EditPlan) {
  const adoptedSceneNumbers: number[] = [];
  const scenes = project.currentVersion.scenes.map((scene) => {
    const preview = planPreviewAsset(scene, plan.id);
    if (!preview) return scene;
    adoptedSceneNumbers.push(scene.sceneNumber);
    const promoted: SceneAsset = {
      ...preview,
      type: "image",
      metadata: {
        ...preview.metadata,
        candidate: false,
        planPreview: false,
        adoptedFromEditPlanId: plan.id,
        adoptedAt: new Date().toISOString()
      }
    };
    return {
      ...scene,
      assets: [
        promoted,
        ...scene.assets.filter((asset) => (
          asset.id !== preview.id
          && asset.type !== "image"
          && asset.type !== "clip"
          && !(asset.type === "thumbnail" && asset.metadata?.planPreview === true && asset.metadata?.editPlanId === plan.id)
        ))
      ]
    };
  });
  return {
    project: {
      ...project,
      currentVersion: { ...project.currentVersion, scenes }
    },
    adoptedSceneNumbers
  };
}

export function removeEditPlanPreviewAssets(project: Project, editPlanId: string) {
  return {
    ...project,
    currentVersion: {
      ...project.currentVersion,
      scenes: project.currentVersion.scenes.map((scene) => ({
        ...scene,
        assets: scene.assets.filter((asset) => !(
          asset.type === "thumbnail"
          && asset.metadata?.planPreview === true
          && asset.metadata?.editPlanId === editPlanId
        ))
      }))
    }
  };
}
