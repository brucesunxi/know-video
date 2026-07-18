import { analyzeEditIntent, globalEditTargetSceneNumbers } from "@/lib/edit-intent";
import type { AssetType, EditChange, EditPlan, GenerationReferenceAsset, ProjectVersion } from "@/lib/types";

export function bindReferenceAssetsToPlan(params: {
  plan: EditPlan;
  references: GenerationReferenceAsset[];
  version: ProjectVersion;
  selectedSceneNumber?: number;
}): EditPlan {
  if (params.references.length === 0) return params.plan;
  const available = new Set(params.version.scenes.map((scene) => scene.sceneNumber));
  const primaryTargetSceneNumber = params.plan.affectedScenes.find((sceneNumber) => sceneNumber === params.selectedSceneNumber)
    ?? params.plan.affectedScenes.find((sceneNumber) => available.has(sceneNumber))
    ?? (params.selectedSceneNumber && available.has(params.selectedSceneNumber) ? params.selectedSceneNumber : params.version.scenes[0]?.sceneNumber);
  if (!primaryTargetSceneNumber) return params.plan;
  const intent = analyzeEditIntent(params.plan.userRequest, Array.from(available));
  const visualTargetSceneNumbers = intent.global
    ? globalEditTargetSceneNumbers(params.plan.userRequest, Array.from(available))
    : [primaryTargetSceneNumber];
  const visualReferences = params.references.filter((reference) =>
    reference.contentType.startsWith("image/") || reference.contentType.startsWith("video/")
  );
  let changes = params.plan.changes;
  const sceneSide = (sceneNumber: number) => {
    const scene = params.version.scenes.find((item) => item.sceneNumber === sceneNumber);
    return scene ? {
      title: scene.title,
      voiceover: scene.voiceover,
      narrationVoice: scene.style.narrationVoice,
      thumbnailTone: scene.style.theme.includes("light") ? "light" : "dark",
      visualPrompt: scene.visualPrompt,
      motionPrompt: scene.motionPrompt
    } : undefined;
  };
  if (visualReferences.length > 0) {
    const identity = visualReferences
      .map((reference) => reference.analysis || `${reference.name} 中的主体、构图与视觉身份`)
      .join("；")
      .slice(0, 2400);
    for (const sceneNumber of visualTargetSceneNumbers) {
      const currentSide = sceneSide(sceneNumber);
      if (!currentSide) continue;
      const existing = changes.find((change) => change.sceneNumber === sceneNumber);
      const nextPrompt = `${existing?.after.visualPrompt ?? currentSide.visualPrompt}\n\n必须以用户本次上传的参考素材为视觉依据，保留可辨识的主体、产品、人物、品牌和构图连续性：${identity}`;
      const forced: EditChange = existing
        ? {
            ...existing,
            after: { ...existing.after, visualPrompt: nextPrompt },
            regenerate: Array.from(new Set([...existing.regenerate, "image", "thumbnail", "render"] as const))
          }
        : {
            sceneNumber,
            status: "updated" as const,
            before: currentSide,
            after: { ...currentSide, visualPrompt: nextPrompt },
            regenerate: ["image", "thumbnail", "render"] satisfies AssetType[]
          };
      changes = existing
        ? changes.map((change) => change.sceneNumber === sceneNumber ? forced : change)
        : [...changes, forced];
    }
  }
  const transcriptReference = params.references.find((reference) =>
    reference.analysisKind === "transcript" && reference.analysis?.trim()
  );
  const useTranscriptAsNarration = /(?:把|将|用|使用|采用).{0,12}(?:录音|音频).{0,12}(?:内容|台词|口播|旁白)|(?:录音|音频).{0,12}(?:作为|改成|变成).{0,8}(?:口播|旁白)|use.{0,20}(?:recording|audio).{0,20}(?:transcript|narration|voiceover)/iu.test(params.plan.userRequest);
  const primarySide = sceneSide(primaryTargetSceneNumber);
  if (transcriptReference?.analysis && useTranscriptAsNarration && primarySide) {
    const transcript = transcriptReference.analysis
      .replace(/[\u0000-\u001f\u007f<>]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
    if (transcript) {
      const existing = changes.find((change) => change.sceneNumber === primaryTargetSceneNumber);
      const transcriptChange: EditChange = existing
        ? {
            ...existing,
            after: { ...existing.after, voiceover: transcript },
            regenerate: Array.from(new Set([...existing.regenerate, "audio", "caption", "render"] as const))
          }
        : {
            sceneNumber: primaryTargetSceneNumber,
            status: "updated",
            before: primarySide,
            after: { ...primarySide, voiceover: transcript },
            regenerate: ["audio", "caption", "render"] satisfies AssetType[]
          };
      changes = existing
        ? changes.map((change) => change.sceneNumber === primaryTargetSceneNumber ? transcriptChange : change)
        : [...changes, transcriptChange];
    }
  }
  return {
    ...params.plan,
    summary: `${params.plan.summary} 已把本次上传素材作为${visualTargetSceneNumbers.length > 1 ? `场景 ${visualTargetSceneNumbers.join("、")}` : `场景 ${primaryTargetSceneNumber}`}的生成依据。`,
    affectedScenes: Array.from(new Set([...params.plan.affectedScenes, ...visualTargetSceneNumbers, primaryTargetSceneNumber])).sort((a, b) => a - b),
    changes: [...changes].sort((left, right) => left.sceneNumber - right.sceneNumber),
    referenceAssets: params.references.map((reference) => reference.contentType.startsWith("image/") || reference.contentType.startsWith("video/")
      ? { ...reference, targetSceneNumber: primaryTargetSceneNumber, targetSceneNumbers: visualTargetSceneNumbers }
      : { ...reference, targetSceneNumber: primaryTargetSceneNumber })
  };
}
