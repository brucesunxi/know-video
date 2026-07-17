import { NextResponse } from "next/server";
import { z } from "zod";
import { demoProject } from "@/lib/mock-data";
import { createEditPlan } from "@/lib/ai-video";
import { candidateEditFromRequest } from "@/lib/candidate-edit-intent";
import { CandidateImageError, generateSceneImageCandidate } from "@/lib/image-candidates";
import { loadCurrentProjectForEdit, persistCandidateEditConversation, persistEditPlan } from "@/lib/project-mutations";
import type { ChatMessage, ProjectVersion } from "@/lib/types";

const requestSchema = z.object({
  request: z.string().trim().min(1).max(4000),
  projectId: z.string().optional(),
  versionId: z.string().optional()
}).refine(
  (value) => Boolean(value.projectId) === Boolean(value.versionId),
  { message: "项目和版本信息必须同时提供。" }
);

function publicEngine(engine: string) {
  return engine === "heuristic" ? "heuristic" : "ai";
}

export const maxDuration = 120;

export async function POST(request: Request) {
  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof z.ZodError ? "修改要求格式无效。" : "无法读取修改要求。" },
      { status: 400 }
    );
  }
  const currentProject = body.projectId && body.versionId
    ? await loadCurrentProjectForEdit(body.projectId, body.versionId)
    : undefined;
  if (body.projectId && body.versionId && !currentProject) {
    return NextResponse.json(
      { error: "视频版本已经发生变化，请刷新后重新生成修改方案。" },
      { status: 409 }
    );
  }
  const candidateIntent = currentProject
    ? candidateEditFromRequest(body.request, currentProject.currentVersion.scenes.map((scene) => scene.sceneNumber))
    : undefined;
  if (currentProject && body.projectId && body.versionId && candidateIntent) {
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
    const result = await createEditPlan({
      request: body.request,
      version: workingVersion,
      editNumber
    });
    editPlan = result.editPlan;
    engine = result.engine;
  } catch (error) {
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
