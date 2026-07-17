import type { AssetType, EditPlan, Scene } from "@/lib/types";
import { analyzeEditIntent, requestsGeneratedClip } from "@/lib/edit-intent";

export function normalizeEditPlanAgainstScenes(plan: EditPlan, scenes: Scene[]) {
  const sceneByNumber = new Map(scenes.map((scene) => [scene.sceneNumber, scene]));
  const intent = analyzeEditIntent(plan.userRequest, scenes.map((scene) => scene.sceneNumber));
  const preserveVisualAssets = intent.preserveVisualAssetsOnLocalization;
  const clipRequested = requestsGeneratedClip(plan.userRequest);
  const ambiguousClipRequest = clipRequested && intent.explicitSceneNumbers.length === 0 && !intent.global;
  const explicitlyAllowed = !intent.global && intent.explicitSceneNumbers.length > 0
    ? new Set(intent.explicitSceneNumbers)
    : undefined;
  const seen = new Set<number>();
  const changes = (ambiguousClipRequest ? [] : plan.changes).flatMap((change) => {
    const scene = sceneByNumber.get(change.sceneNumber);
    if (
      !scene
      || seen.has(change.sceneNumber)
      || (explicitlyAllowed && !explicitlyAllowed.has(change.sceneNumber))
      || change.status !== "updated"
    ) return [];
    seen.add(change.sceneNumber);

    const currentTone = scene.style.theme.includes("light") ? "light" : "dark";
    const title = change.after.title ?? scene.title;
    const voiceover = change.after.voiceover ?? scene.voiceover;
    const narrationVoice = change.after.narrationVoice ?? scene.style.narrationVoice;
    const thumbnailTone = change.after.thumbnailTone ?? currentTone;
    const visualPrompt = change.after.visualPrompt ?? scene.visualPrompt;
    const motionPrompt = change.after.motionPrompt ?? scene.motionPrompt;
    const visualChanged = !preserveVisualAssets && (
      visualPrompt !== scene.visualPrompt
      || thumbnailTone !== currentTone
    );
    const voiceoverChanged = voiceover !== scene.voiceover;
    const voiceChanged = narrationVoice !== scene.style.narrationVoice;
    const audioChanged = voiceoverChanged || voiceChanged;
    const captionChanged = title !== scene.title || voiceoverChanged;
    const motionChanged = motionPrompt !== scene.motionPrompt;
    if (!visualChanged && !audioChanged && !captionChanged && !motionChanged && !clipRequested) return [];
    const regenerate = new Set<AssetType>();
    if (visualChanged) {
      regenerate.add("image");
      regenerate.add("thumbnail");
    }
    if (audioChanged) regenerate.add("audio");
    if (captionChanged) regenerate.add("caption");
    if (clipRequested || ((motionChanged || visualChanged) && scene.assets.some((asset) => asset.type === "clip"))) {
      regenerate.add("clip");
    }
    if (visualChanged || audioChanged || captionChanged || motionChanged || clipRequested) {
      regenerate.add("render");
    }

    return [{
      ...change,
      before: {
        title: scene.title,
        voiceover: scene.voiceover,
        narrationVoice: scene.style.narrationVoice,
        thumbnailTone: currentTone,
        visualPrompt: scene.visualPrompt,
        motionPrompt: scene.motionPrompt
      },
      after: {
        ...change.after,
        title,
        voiceover,
        narrationVoice,
        thumbnailTone,
        visualPrompt,
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
