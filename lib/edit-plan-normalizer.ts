import type { AssetType, EditPlan, Scene } from "@/lib/types";
import { analyzeEditIntent } from "@/lib/edit-intent";

export function normalizeEditPlanAgainstScenes(plan: EditPlan, scenes: Scene[]) {
  const sceneByNumber = new Map(scenes.map((scene) => [scene.sceneNumber, scene]));
  const intent = analyzeEditIntent(plan.userRequest, scenes.map((scene) => scene.sceneNumber));
  const preserveVisualAssets = intent.preserveVisualAssetsOnLocalization;
  const seen = new Set<number>();
  const changes = plan.changes.flatMap((change) => {
    const scene = sceneByNumber.get(change.sceneNumber);
    if (!scene || seen.has(change.sceneNumber)) return [];
    seen.add(change.sceneNumber);

    const currentTone = scene.style.theme.includes("light") ? "light" : "dark";
    const voiceover = change.after.voiceover ?? scene.voiceover;
    const motionPrompt = change.after.motionPrompt ?? scene.motionPrompt;
    const visualChanged = !preserveVisualAssets && (
      change.after.visualPrompt !== scene.visualPrompt
      || change.after.thumbnailTone !== currentTone
    );
    const audioChanged = voiceover !== scene.voiceover;
    const captionChanged = change.after.title !== scene.title || audioChanged;
    const motionChanged = motionPrompt !== scene.motionPrompt;
    if (!visualChanged && !audioChanged && !captionChanged && !motionChanged) return [];
    const regenerate = new Set<AssetType>();
    if (visualChanged) {
      regenerate.add("image");
      regenerate.add("thumbnail");
    }
    if (audioChanged) regenerate.add("audio");
    if (captionChanged) regenerate.add("caption");
    if (visualChanged || audioChanged || captionChanged || motionChanged) {
      regenerate.add("render");
    }

    return [{
      ...change,
      before: {
        title: scene.title,
        voiceover: scene.voiceover,
        thumbnailTone: currentTone,
        visualPrompt: scene.visualPrompt,
        motionPrompt: scene.motionPrompt
      },
      after: {
        ...change.after,
        voiceover,
        motionPrompt
      },
      regenerate: Array.from(regenerate)
    }];
  });

  return {
    ...plan,
    affectedScenes: changes.map((change) => change.sceneNumber),
    changes
  };
}
