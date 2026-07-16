import { NextResponse } from "next/server";
import { z } from "zod";
import { demoProject } from "@/lib/mock-data";
import { createEditPlan } from "@/lib/ai-video";
import { loadCurrentProjectForEdit, persistEditPlan } from "@/lib/project-mutations";
import type { ProjectVersion } from "@/lib/types";

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
