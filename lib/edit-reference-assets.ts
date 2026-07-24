import { analyzeEditIntent, globalEditTargetSceneNumbers } from "@/lib/edit-intent";
import type { AssetType, EditChange, EditPlan, GenerationReferenceAsset, ProjectVersion } from "@/lib/types";

export function bindReferenceAssetsToPlan(params: {
  plan: EditPlan;
  references: GenerationReferenceAsset[];
  version: ProjectVersion;
  selectedSceneNumber?: number;
}): EditPlan {
  const productionAssets = params.plan.productionAssets
    ? { ...params.plan.productionAssets }
    : undefined;
  const productionReferenceKeys = new Set<string>();
  if (productionAssets?.logo?.action === "attach-upload") {
    const reference = params.references.find((item) => item.contentType.startsWith("image/"));
    if (!reference) throw new Error("请上传一张图片，再把它设为全片 Logo。");
    productionAssets.logo = { ...productionAssets.logo, referenceKey: reference.key };
    productionReferenceKeys.add(reference.key);
  }
  if (productionAssets?.music?.action === "attach-upload") {
    const reference = params.references.find((item) => item.contentType.startsWith("audio/"));
    if (!reference) throw new Error("请上传一个音频文件，再把它设为背景音乐。");
    productionAssets.music = { ...productionAssets.music, referenceKey: reference.key };
    productionReferenceKeys.add(reference.key);
  }
  if (params.references.length === 0) return { ...params.plan, productionAssets };
  const sceneReferences = params.references.filter((reference) => !productionReferenceKeys.has(reference.key));
  const available = new Set(params.version.scenes.map((scene) => scene.sceneNumber));
  const primaryTargetSceneNumber = params.plan.affectedScenes.find((sceneNumber) => sceneNumber === params.selectedSceneNumber)
    ?? params.plan.affectedScenes.find((sceneNumber) => available.has(sceneNumber))
    ?? (params.selectedSceneNumber && available.has(params.selectedSceneNumber) ? params.selectedSceneNumber : params.version.scenes[0]?.sceneNumber);
  if (!primaryTargetSceneNumber) {
    return {
      ...params.plan,
      productionAssets,
      referenceAssets: params.references.map((reference) => ({
        ...reference,
        referenceUsage: reference.key === productionAssets?.logo?.referenceKey
          ? "production-logo" as const
          : reference.key === productionAssets?.music?.referenceKey
            ? "production-music" as const
            : reference.referenceUsage
      }))
    };
  }
  const intent = analyzeEditIntent(params.plan.userRequest, Array.from(available));
  const visualTargetSceneNumbers = intent.global
    ? globalEditTargetSceneNumbers(params.plan.userRequest, Array.from(available))
    : [primaryTargetSceneNumber];
  const visualContextReferences = sceneReferences.filter((reference) =>
    reference.contentType.startsWith("image/") || reference.contentType.startsWith("video/")
  );
  const visualReferences = visualContextReferences.filter((reference) =>
    (reference.contentType.startsWith("image/") || reference.contentType.startsWith("video/"))
      && reference.referenceRole !== "video-poster"
  );
  const directVisualRequest = /(?:直接)?(?:用|使用|采用|把|将).{0,18}(?:这|该|上传|附件|本次)?.{0,8}(?:张图|图片|照片|视频|片段|素材).{0,18}(?:作为|当作|放到|放进|用在|替换|画面|背景)|(?:把|将).{0,12}(?:张图|图片|照片|视频|片段).{0,18}(?:放到|放进|用在|作为|替换)/u.test(params.plan.userRequest)
    && !/(?:作为|当作|用作)?.{0,4}(?:视觉)?参考|参考.{0,12}(?:风格|构图|色彩|调性)|借鉴/u.test(params.plan.userRequest);
  const requestedVideo = /视频|片段|clip|footage/iu.test(params.plan.userRequest);
  const requestedImage = /张图|图片|照片|image|photo/iu.test(params.plan.userRequest);
  const directVisualReference = directVisualRequest
    ? (requestedVideo ? visualReferences.find((reference) => reference.contentType.startsWith("video/")) : undefined)
      ?? (requestedImage ? visualReferences.find((reference) => reference.contentType.startsWith("image/")) : undefined)
      ?? visualReferences.find((reference) => reference.contentType.startsWith("video/"))
      ?? visualReferences[0]
    : undefined;
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
  if (visualContextReferences.length > 0) {
    const identity = visualContextReferences
      .map((reference) => reference.analysis || `${reference.name} 中的主体、构图与视觉身份`)
      .join("；")
      .slice(0, 2400);
    for (const sceneNumber of visualTargetSceneNumbers) {
      const currentSide = sceneSide(sceneNumber);
      if (!currentSide) continue;
      const existing = changes.find((change) => change.sceneNumber === sceneNumber);
      const nextPrompt = `${existing?.after.visualPrompt ?? currentSide.visualPrompt}\n\n必须以用户本次上传的参考素材为视觉依据，保留可辨识的主体、产品、人物、品牌和构图连续性：${identity}`;
      const visualRegenerate = directVisualReference
        ? Array.from(new Set([...(existing?.regenerate ?? []).filter((type) => !["image", "clip", "thumbnail"].includes(type)), "render"] as const))
        : Array.from(new Set([...(existing?.regenerate ?? []), "image", "thumbnail", "render"] as const));
      const forced: EditChange = existing
        ? {
            ...existing,
            after: { ...existing.after, visualPrompt: nextPrompt },
            regenerate: visualRegenerate
          }
        : {
            sceneNumber,
            status: "updated" as const,
            before: currentSide,
            after: { ...currentSide, visualPrompt: nextPrompt },
            regenerate: directVisualReference
              ? ["render"] satisfies AssetType[]
              : ["image", "thumbnail", "render"] satisfies AssetType[]
          };
      changes = existing
        ? changes.map((change) => change.sceneNumber === sceneNumber ? forced : change)
        : [...changes, forced];
    }
  }
  const transcriptReference = sceneReferences.find((reference) =>
    reference.analysisKind === "transcript" && reference.analysis?.trim()
  );
  const audioReferences = sceneReferences.filter((reference) => reference.contentType.startsWith("audio/"));
  const directAudioRequest = productionAssets?.music?.action !== "attach-upload"
    && /(?:直接)?(?:用|使用|采用|把|将).{0,16}(?:这|该|上传|附件|本次)?.{0,8}(?:录音|音频|原声|声音).{0,16}(?:作为|当作|替换|配音|旁白|音轨)|(?:保留|使用).{0,10}(?:原声|原始声音)/u.test(params.plan.userRequest)
    && !/(?:录音|音频).{0,10}(?:内容|文字|台词|转写)|(?:内容|文字|台词|转写).{0,10}(?:录音|音频)/u.test(params.plan.userRequest);
  const directAudioReference = directAudioRequest
    ? audioReferences.find((reference) => reference.analysisKind === "transcript" && reference.analysis?.trim())
    : undefined;
  if (directAudioRequest && !directAudioReference) {
    throw new Error("没有识别出这段原声的有效旁白内容，请重新上传清晰录音后再直接采用。");
  }
  const primaryScene = params.version.scenes.find((scene) => scene.sceneNumber === primaryTargetSceneNumber);
  if (
    directAudioReference?.actualDurationSeconds
    && primaryScene
    && directAudioReference.actualDurationSeconds > primaryScene.durationSeconds + 0.18
  ) {
    throw new Error(`这段原声约 ${directAudioReference.actualDurationSeconds.toFixed(1)} 秒，超过场景 ${primaryTargetSceneNumber} 的 ${primaryScene.durationSeconds.toFixed(1)} 秒。请先延长场景或上传更短的录音。`);
  }
  const useTranscriptAsNarration = /(?:把|将|用|使用|采用).{0,12}(?:录音|音频).{0,12}(?:内容|台词|口播|旁白)|(?:录音|音频).{0,12}(?:作为|改成|变成).{0,8}(?:口播|旁白)|use.{0,20}(?:recording|audio).{0,20}(?:transcript|narration|voiceover)/iu.test(params.plan.userRequest);
  const primarySide = sceneSide(primaryTargetSceneNumber);
  if (transcriptReference?.analysis && (useTranscriptAsNarration || directAudioReference) && primarySide) {
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
            regenerate: directAudioReference
              ? Array.from(new Set([...existing.regenerate.filter((type) => type !== "audio"), "caption", "render"] as const))
              : Array.from(new Set([...existing.regenerate, "audio", "caption", "render"] as const))
          }
        : {
            sceneNumber: primaryTargetSceneNumber,
            status: "updated",
            before: primarySide,
            after: { ...primarySide, voiceover: transcript },
            regenerate: directAudioReference
              ? ["caption", "render"] satisfies AssetType[]
              : ["audio", "caption", "render"] satisfies AssetType[]
          };
      changes = existing
        ? changes.map((change) => change.sceneNumber === primaryTargetSceneNumber ? transcriptChange : change)
        : [...changes, transcriptChange];
    }
  }
  return {
    ...params.plan,
    productionAssets,
    summary: sceneReferences.length > 0
      ? `${params.plan.summary} 已把本次上传素材${directVisualReference || directAudioReference ? "直接用于" : "作为生成依据用于"}${visualTargetSceneNumbers.length > 1 ? `场景 ${visualTargetSceneNumbers.join("、")}` : `场景 ${primaryTargetSceneNumber}`}。`
      : params.plan.summary,
    affectedScenes: Array.from(new Set([
      ...params.plan.affectedScenes,
      ...(sceneReferences.length > 0 ? [...visualTargetSceneNumbers, primaryTargetSceneNumber] : [])
    ])).sort((a, b) => a - b),
    changes: [...changes].sort((left, right) => left.sceneNumber - right.sceneNumber),
    referenceAssets: params.references.map((reference) => reference.key === productionAssets?.logo?.referenceKey
        ? { ...reference, referenceUsage: "production-logo" as const }
        : reference.key === productionAssets?.music?.referenceKey
          ? { ...reference, referenceUsage: "production-music" as const }
          : reference.contentType.startsWith("image/") || reference.contentType.startsWith("video/")
        ? {
            ...reference,
            targetSceneNumber: primaryTargetSceneNumber,
            targetSceneNumbers: visualTargetSceneNumbers,
            referenceUsage: reference.key === directVisualReference?.key ? "source-media" as const : undefined
          }
        : {
            ...reference,
            targetSceneNumber: primaryTargetSceneNumber,
            referenceUsage: reference.key === directAudioReference?.key ? "source-media" as const : undefined
          })
  };
}
