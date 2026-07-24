import { NextResponse } from "next/server";
import { z } from "zod";
import { authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { demoProject } from "@/lib/mock-data";
import { createEditPlan, refineEditPlan } from "@/lib/ai-video";
import { bindReferenceAssetsToPlan } from "@/lib/edit-reference-assets";
import { generationReferenceContext } from "@/lib/generation-reference-assets";
import { CandidateImageError, generateSceneImageCandidate } from "@/lib/image-candidates";
import {
  loadCurrentProjectForEdit,
  loadProposedEditPlan,
  persistCandidateEditConversation,
  persistEditPlan,
  restoreProjectVersion
} from "@/lib/project-mutations";
import { referenceAssetInputSchema, validateAndAnalyzeReferenceAssets, validateReferenceRelationships } from "@/lib/reference-asset-processing";
import { deleteUnreferencedStorageObjects } from "@/lib/storage-cleanup";
import type { ChatMessage, ProjectVersion } from "@/lib/types";

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

export async function POST(request: Request) {
  let user;
  let body: z.infer<typeof requestSchema>;
  let uploadedReferenceKeys: string[] = [];
  try {
    user = await requireCurrentUser();
    body = requestSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    return NextResponse.json(
      { error: error instanceof z.ZodError ? "修改要求格式无效。" : "无法读取修改要求。" },
      { status: 400 }
    );
  }
  uploadedReferenceKeys = body.requestId
    ? body.referenceAssets.map((reference) => reference.key).filter((key) => key.startsWith(`uploads/generation/${body.requestId}/`))
    : [];
  const currentProject = body.projectId && body.versionId
    ? await loadCurrentProjectForEdit(body.projectId, body.versionId, user.id)
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
  const workingVersion: ProjectVersion = currentProject?.currentVersion ?? demoProject.currentVersion;
  const editNumber = Math.max(1, Math.round(Date.now() / 1000) % 10000);

  let editPlan;
  let engine;
  try {
    const references = body.requestId && body.referenceAssets.length > 0
      ? await validateAndAnalyzeReferenceAssets({ requestId: body.requestId, references: body.referenceAssets })
      : [];
    const requestAttachmentContext = references.length > 0
      ? `${generationReferenceContext(references)}\nThese attachments belong to this edit request. Infer their intended role from the user's request. Only bind them to a selected or named scene when the request is actually scene-level; full-video Logo and background-music requests are production assets.`
      : undefined;
    const result = existingPlan
      ? await refineEditPlan({
          request: body.request,
          version: workingVersion,
          existingPlan,
          editNumber,
          requestAttachmentContext,
          selectedSceneNumber: body.selectedSceneNumber
        })
      : await createEditPlan({
          request: body.request,
          version: workingVersion,
          editNumber,
          requestAttachmentContext,
          selectedSceneNumber: body.selectedSceneNumber,
          allowDirectActions: references.length === 0
        });
    if (result.directAction) {
      if (!currentProject || !body.projectId || !body.versionId) {
        throw new Error("这项操作需要在已保存的视频项目中执行。");
      }
      if (result.directAction.kind === "restore-parent-version") {
        if (!currentProject.currentVersion.parentVersionId) {
          throw new Error("当前已经是最早版本，没有可以撤销的上一个版本。");
        }
        const restored = await restoreProjectVersion({
          projectId: body.projectId,
          targetVersionId: currentProject.currentVersion.parentVersionId,
          userId: user.id,
          userRequest: body.request
        });
        return NextResponse.json({
          action: "version-restored",
          project: restored.project,
          messages: [restored.message]
        });
      }
      const candidateIntent = {
        sceneNumber: result.directAction.sceneNumber,
        instruction: result.directAction.instruction
      };
      const candidateResult = await generateSceneImageCandidate(currentProject, {
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
          candidateAssetId: candidateResult.candidate.id
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
        candidate: candidateResult.candidate,
        project: candidateResult.project,
        messages
      });
    }
    if (!result.editPlan) throw new Error("AI 没有生成可执行的修改方案。");
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
      { status: error instanceof CandidateImageError ? error.status : 502 }
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
