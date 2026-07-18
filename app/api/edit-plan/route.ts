import { NextResponse } from "next/server";
import { z } from "zod";
import { demoProject } from "@/lib/mock-data";
import { createEditPlan, refineEditPlan } from "@/lib/ai-video";
import { candidateEditFromRequest } from "@/lib/candidate-edit-intent";
import { generationReferenceContext } from "@/lib/generation-reference-assets";
import { CandidateImageError, generateSceneImageCandidate } from "@/lib/image-candidates";
import { loadCurrentProjectForEdit, loadProposedEditPlan, persistCandidateEditConversation, persistEditPlan } from "@/lib/project-mutations";
import { referenceAssetInputSchema, validateAndAnalyzeReferenceAssets, validateReferenceRelationships } from "@/lib/reference-asset-processing";
import { deleteUnreferencedStorageObjects } from "@/lib/storage-cleanup";
import type { AssetType, ChatMessage, EditChange, EditPlan, GenerationReferenceAsset, ProjectVersion } from "@/lib/types";

const requestSchema = z.object({
  request: z.string().trim().min(1).max(4000),
  projectId: z.string().optional(),
  versionId: z.string().optional(),
  selectedSceneNumber: z.number().int().positive().optional(),
  editPlanId: z.string().min(1).max(200).optional(),
  requestId: z.string().uuid().optional(),
  referenceAssets: z.array(referenceAssetInputSchema).max(12).default([])
}).refine(
  (value) => Boolean(value.projectId) === Boolean(value.versionId),
  { message: "项目和版本信息必须同时提供。" }
).refine(
  (value) => !value.editPlanId || Boolean(value.projectId && value.versionId),
  { message: "细化修改方案需要项目和版本信息。" }
).superRefine((value, context) => {
  if (value.referenceAssets.length > 0 && !value.requestId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "上传参考素材时必须提供任务标识。" });
  }
  if (value.referenceAssets.length > 0 && value.editPlanId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "请先处理当前修改方案，再添加新的参考素材。" });
  }
  validateReferenceRelationships(value.referenceAssets, context);
});

function publicEngine(engine: string) {
  return engine === "heuristic" ? "heuristic" : "ai";
}

export const maxDuration = 120;

function bindReferenceAssetsToPlan(params: {
  plan: EditPlan;
  references: GenerationReferenceAsset[];
  version: ProjectVersion;
  selectedSceneNumber?: number;
}): EditPlan {
  if (params.references.length === 0) return params.plan;
  const available = new Set(params.version.scenes.map((scene) => scene.sceneNumber));
  const targetSceneNumber = params.plan.affectedScenes.find((sceneNumber) => sceneNumber === params.selectedSceneNumber)
    ?? params.plan.affectedScenes.find((sceneNumber) => available.has(sceneNumber))
    ?? (params.selectedSceneNumber && available.has(params.selectedSceneNumber) ? params.selectedSceneNumber : params.version.scenes[0]?.sceneNumber);
  if (!targetSceneNumber) return params.plan;
  const visualReferences = params.references.filter((reference) =>
    reference.contentType.startsWith("image/") || reference.contentType.startsWith("video/")
  );
  let changes = params.plan.changes;
  const sourceScene = params.version.scenes.find((item) => item.sceneNumber === targetSceneNumber);
  const currentSide = sourceScene ? {
    title: sourceScene.title,
    voiceover: sourceScene.voiceover,
    narrationVoice: sourceScene.style.narrationVoice,
    thumbnailTone: sourceScene.style.theme.includes("light") ? "light" : "dark",
    visualPrompt: sourceScene.visualPrompt,
    motionPrompt: sourceScene.motionPrompt
  } : undefined;
  if (visualReferences.length > 0) {
    if (sourceScene && currentSide) {
      const identity = visualReferences
        .map((reference) => reference.analysis || `${reference.name} 中的主体、构图与视觉身份`)
        .join("；")
        .slice(0, 2400);
      const existing = changes.find((change) => change.sceneNumber === targetSceneNumber);
      const nextPrompt = `${existing?.after.visualPrompt ?? sourceScene.visualPrompt}\n\n必须以用户本次上传的参考素材为视觉依据，保留可辨识的主体、产品、人物、品牌和构图连续性：${identity}`;
      const forced: EditChange = existing
        ? {
            ...existing,
            after: { ...existing.after, visualPrompt: nextPrompt },
            regenerate: Array.from(new Set([...existing.regenerate, "image", "thumbnail", "render"] as const))
          }
        : {
            sceneNumber: targetSceneNumber,
            status: "updated" as const,
            before: currentSide,
            after: {
              ...currentSide,
              visualPrompt: nextPrompt,
            },
            regenerate: ["image", "thumbnail", "render"] satisfies AssetType[]
          };
      changes = existing
        ? changes.map((change) => change.sceneNumber === targetSceneNumber ? forced : change)
        : [...changes, forced];
    }
  }
  const transcriptReference = params.references.find((reference) =>
    reference.analysisKind === "transcript" && reference.analysis?.trim()
  );
  const useTranscriptAsNarration = /(?:把|将|用|使用|采用).{0,12}(?:录音|音频).{0,12}(?:内容|台词|口播|旁白)|(?:录音|音频).{0,12}(?:作为|改成|变成).{0,8}(?:口播|旁白)|use.{0,20}(?:recording|audio).{0,20}(?:transcript|narration|voiceover)/iu.test(params.plan.userRequest);
  if (transcriptReference?.analysis && useTranscriptAsNarration && currentSide) {
    const transcript = transcriptReference.analysis
      .replace(/[\u0000-\u001f\u007f<>]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
    if (transcript) {
      const existing = changes.find((change) => change.sceneNumber === targetSceneNumber);
      const transcriptChange: EditChange = existing
        ? {
            ...existing,
            after: { ...existing.after, voiceover: transcript },
            regenerate: Array.from(new Set([...existing.regenerate, "audio", "caption", "render"] as const))
          }
        : {
            sceneNumber: targetSceneNumber,
            status: "updated",
            before: currentSide,
            after: { ...currentSide, voiceover: transcript },
            regenerate: ["audio", "caption", "render"] satisfies AssetType[]
          };
      changes = existing
        ? changes.map((change) => change.sceneNumber === targetSceneNumber ? transcriptChange : change)
        : [...changes, transcriptChange];
    }
  }
  return {
    ...params.plan,
    summary: `${params.plan.summary} 已把本次上传素材作为场景 ${targetSceneNumber} 的生成依据。`,
    affectedScenes: Array.from(new Set([...params.plan.affectedScenes, targetSceneNumber])).sort((a, b) => a - b),
    changes,
    referenceAssets: params.references.map((reference) => ({ ...reference, targetSceneNumber }))
  };
}

export async function POST(request: Request) {
  let body: z.infer<typeof requestSchema>;
  let uploadedReferenceKeys: string[] = [];
  try {
    body = requestSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof z.ZodError ? "修改要求格式无效。" : "无法读取修改要求。" },
      { status: 400 }
    );
  }
  uploadedReferenceKeys = body.requestId
    ? body.referenceAssets.map((reference) => reference.key).filter((key) => key.startsWith(`uploads/generation/${body.requestId}/`))
    : [];
  const currentProject = body.projectId && body.versionId
    ? await loadCurrentProjectForEdit(body.projectId, body.versionId)
    : undefined;
  if (body.projectId && body.versionId && !currentProject) {
    return NextResponse.json(
      { error: "视频版本已经发生变化，请刷新后重新生成修改方案。" },
      { status: 409 }
    );
  }
  const existingPlan = body.editPlanId && body.projectId && body.versionId
    ? await loadProposedEditPlan({
        projectId: body.projectId,
        versionId: body.versionId,
        editPlanId: body.editPlanId
      })
    : undefined;
  if (body.editPlanId && !existingPlan) {
    return NextResponse.json(
      { error: "当前修改方案已经失效，请重新生成。" },
      { status: 409 }
    );
  }
  const candidateIntent = currentProject
    ? candidateEditFromRequest(
        body.request,
        currentProject.currentVersion.scenes.map((scene) => scene.sceneNumber),
        body.selectedSceneNumber
      )
    : undefined;
  if (!existingPlan && body.referenceAssets.length === 0 && currentProject && body.projectId && body.versionId && candidateIntent) {
    try {
      const result = await generateSceneImageCandidate(currentProject, {
        sceneNumber: candidateIntent.sceneNumber,
        instruction: candidateIntent.instruction,
        quality: "standard"
      });
      const shortInstruction = candidateIntent.instruction.length > 48
        ? `${candidateIntent.instruction.slice(0, 47)}…`
        : candidateIntent.instruction;
      const responseText = `场景 ${candidateIntent.sceneNumber} 已按“${shortInstruction}”生成候选画面。当前视频保持不变，可以在素材面板中对比后再采用。`;
      let messages: ChatMessage[];
      try {
        messages = await persistCandidateEditConversation({
          projectId: body.projectId,
          versionId: body.versionId,
          request: body.request,
          response: responseText,
          sceneNumber: candidateIntent.sceneNumber,
          candidateAssetId: result.candidate.id
        });
      } catch (error) {
        console.error("[edit-plan] Candidate conversation persistence failed:", error);
        messages = [
          { id: crypto.randomUUID(), role: "user", type: "text", content: body.request, versionId: body.versionId },
          { id: crypto.randomUUID(), role: "assistant", type: "text", content: responseText, versionId: body.versionId }
        ];
      }
      return NextResponse.json({
        action: "visual-candidate",
        candidateIntent,
        candidate: result.candidate,
        project: result.project,
        messages
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "候选画面生成失败，请稍后重试。";
      return NextResponse.json(
        { error: message },
        { status: error instanceof CandidateImageError ? error.status : 502 }
      );
    }
  }
  const workingVersion: ProjectVersion = currentProject?.currentVersion ?? demoProject.currentVersion;
  const editNumber = Math.max(1, Math.round(Date.now() / 1000) % 10000);

  let editPlan;
  let engine;
  try {
    const references = body.requestId && body.referenceAssets.length > 0
      ? await validateAndAnalyzeReferenceAssets({ requestId: body.requestId, references: body.referenceAssets })
      : [];
    const requestAttachmentContext = references.length > 0
      ? `${generationReferenceContext(references)}\nThese attachments belong to this edit request. Use them for the selected or explicitly requested target scene.`
      : undefined;
    const result = existingPlan
      ? await refineEditPlan({
          request: body.request,
          version: workingVersion,
          existingPlan,
          editNumber,
          requestAttachmentContext
        })
      : await createEditPlan({
          request: body.request,
          version: workingVersion,
          editNumber,
          requestAttachmentContext
        });
    editPlan = bindReferenceAssetsToPlan({
      plan: result.editPlan,
      references,
      version: workingVersion,
      selectedSceneNumber: body.selectedSceneNumber
    });
    engine = result.engine;
  } catch (error) {
    if (uploadedReferenceKeys.length > 0) {
      await deleteUnreferencedStorageObjects(uploadedReferenceKeys).catch(() => undefined);
    }
    console.error("[edit-plan] Plan generation failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "修改计划生成失败，请重试。" },
      { status: 502 }
    );
  }

  if (body.projectId && body.versionId) {
    try {
      const persisted = await persistEditPlan({
        projectId: body.projectId,
        request: body.request,
        versionId: body.versionId,
        editPlan,
        engine
      });
      return NextResponse.json({ ...persisted, engine: publicEngine(engine) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "修改方案保存失败。";
      return NextResponse.json(
        { error: message },
        { status: /版本已经发生变化/.test(message) ? 409 : 502 }
      );
    }
  }

  return NextResponse.json({
    editPlan,
    engine: publicEngine(engine),
    messages: [
      { id: crypto.randomUUID(), role: "user", type: "text", content: body.request },
      { id: crypto.randomUUID(), role: "assistant", type: "plan", content: editPlan.summary, editPlan }
    ]
  });
}
