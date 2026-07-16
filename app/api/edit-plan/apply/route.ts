import { NextResponse } from "next/server";
import { z } from "zod";
import { applyPersistedEditPlan, loadCurrentProjectForEdit } from "@/lib/project-mutations";
import type { EditPlan } from "@/lib/types";

const editSideSchema = z.object({
  title: z.string().min(1).max(240),
  voiceover: z.string().min(1).max(4000).optional(),
  thumbnailTone: z.string().min(1).max(80),
  visualPrompt: z.string().min(1).max(8000),
  motionPrompt: z.string().min(1).max(4000).optional()
});

const editPlanSchema = z.object({
  id: z.string().min(1).max(200),
  editNumber: z.number().int().positive(),
  baseVersionId: z.string().min(1).max(200),
  status: z.literal("proposed"),
  userRequest: z.string().min(1).max(4000),
  summary: z.string().min(1).max(4000),
  affectedScenes: z.array(z.number().int().positive()).min(1).max(20),
  changes: z.array(z.object({
    sceneNumber: z.number().int().positive(),
    status: z.enum(["updated", "added", "deleted", "unchanged"]),
    before: editSideSchema,
    after: editSideSchema,
    regenerate: z.array(z.enum(["image", "audio", "clip", "thumbnail", "caption", "render"]))
  })).min(1).max(20),
  createdAt: z.string().min(1).max(100)
});

const requestSchema = z.object({
  projectId: z.string().min(1).max(200),
  versionId: z.string().min(1).max(200),
  editPlan: editPlanSchema
});

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    if (body.editPlan.baseVersionId !== body.versionId) {
      return NextResponse.json({ error: "修改方案不是基于当前视频版本生成的，请重新规划。" }, { status: 409 });
    }
    const project = await loadCurrentProjectForEdit(body.projectId, body.versionId);
    if (!project) {
      return NextResponse.json({ error: "视频版本已经发生变化，请刷新后重新修改。" }, { status: 409 });
    }
    const sceneNumbers = new Set(project.currentVersion.scenes.map((scene) => scene.sceneNumber));
    if (body.editPlan.changes.some((change) => !sceneNumbers.has(change.sceneNumber))) {
      return NextResponse.json({ error: "修改方案包含当前版本中不存在的场景。" }, { status: 409 });
    }
    const result = await applyPersistedEditPlan({
      project,
      editPlan: body.editPlan as EditPlan
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "修改方案格式无效，请重新生成。" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "应用修改失败。";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
