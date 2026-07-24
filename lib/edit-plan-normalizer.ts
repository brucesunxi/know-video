import type { AssetType, EditPlan, Scene } from "@/lib/types";
import { analyzeEditIntent, globalEditTargetSceneNumbers, requestsGeneratedClip } from "@/lib/edit-intent";
import { affectedSceneNumbersForOperations, editPlanOperations } from "@/lib/edit-operations";
import { looksSimplifiedChineseLocalized } from "@/lib/language-quality";

export function normalizeEditPlanAgainstScenes(plan: EditPlan, scenes: Scene[]) {
  const sceneByNumber = new Map(scenes.map((scene) => [scene.sceneNumber, scene]));
  const intent = analyzeEditIntent(plan.userRequest, scenes.map((scene) => scene.sceneNumber));
  const preserveVisualAssets = intent.preserveVisualAssetsOnLocalization;
  const clipRequested = requestsGeneratedClip(plan.userRequest);
  const ambiguousClipRequest = clipRequested && intent.explicitSceneNumbers.length === 0 && !intent.global;
  const globalTargets = intent.global
    ? globalEditTargetSceneNumbers(plan.userRequest, scenes.map((scene) => scene.sceneNumber))
    : [];
  if (intent.global && plan.changes.length > 0) {
    const updatedChanges = plan.changes.filter((change) => change.status === "updated");
    const planned = new Set(updatedChanges.map((change) => change.sceneNumber));
    const targets = new Set(globalTargets);
    if (
      updatedChanges.length !== planned.size
      || globalTargets.some((sceneNumber) => !planned.has(sceneNumber))
      || updatedChanges.some((change) => !targets.has(change.sceneNumber))
    ) {
      throw new Error("全局修改方案没有覆盖所有目标场景，请重新生成方案。");
    }
    if (intent.globalChineseRewrite) {
      const changes = new Map(plan.changes.map((change) => [change.sceneNumber, change]));
      const completeChinese = globalTargets.every((sceneNumber) => {
        const after = changes.get(sceneNumber)?.after;
        return after
          && [after.title, after.voiceover, after.visualPrompt, after.motionPrompt]
            .every((value) => looksSimplifiedChineseLocalized(value));
      });
      if (!completeChinese) throw new Error("全片中文修改方案存在未完成的中文字段，请重新生成方案。");
    }
  }
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
    const sourceReferences = plan.referenceAssets?.filter((reference) =>
      reference.referenceUsage === "source-media"
      && (reference.targetSceneNumber === scene.sceneNumber || reference.targetSceneNumbers?.includes(scene.sceneNumber))
    ) ?? [];
    const directVisualSource = sourceReferences.some((reference) =>
      reference.contentType.startsWith("image/") || reference.contentType.startsWith("video/")
    );
    const directAudioSource = sourceReferences.some((reference) => reference.contentType.startsWith("audio/"));
    if (!visualChanged && !audioChanged && !captionChanged && !motionChanged && !clipRequested) return [];
    const regenerate = new Set<AssetType>();
    if (visualChanged && !directVisualSource) {
      regenerate.add("image");
      regenerate.add("thumbnail");
    }
    if (audioChanged && !directAudioSource) regenerate.add("audio");
    if (captionChanged) regenerate.add("caption");
    if (clipRequested || (!directVisualSource && (motionChanged || visualChanged) && scene.assets.some((asset) => asset.type === "clip"))) {
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
    affectedScenes: Array.from(new Set([
      ...changes.map((change) => change.sceneNumber),
      ...affectedSceneNumbersForOperations(editPlanOperations(plan))
    ])).sort((left, right) => left - right),
    changes
  };
}
