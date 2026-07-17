import { NextResponse } from "next/server";
import { z } from "zod";
import { generateEditPlanVisualPreviews } from "@/lib/edit-plan-preview";
import { loadCurrentProjectForEdit, loadProposedEditPlan } from "@/lib/project-mutations";

const requestSchema = z.object({
  projectId: z.string().min(1).max(200),
  versionId: z.string().min(1).max(200),
  editPlanId: z.string().min(1).max(200)
});

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const project = await loadCurrentProjectForEdit(body.projectId, body.versionId);
    if (!project) {
      return NextResponse.json({ error: "视频版本已经发生变化，请刷新后重新修改。" }, { status: 409 });
    }
    const editPlan = await loadProposedEditPlan({
      projectId: body.projectId,
      versionId: body.versionId,
      editPlanId: body.editPlanId
    });
    if (!editPlan) {
      return NextResponse.json({ error: "修改方案已经失效，请重新生成。" }, { status: 409 });
    }
    const updated = await generateEditPlanVisualPreviews(project, editPlan);
    return NextResponse.json({ project: updated });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? "修改预览信息无效，请刷新后重试。"
      : error instanceof Error
        ? error.message
        : "修改预览生成失败，请稍后重试。";
    return NextResponse.json({ error: message }, { status: error instanceof z.ZodError ? 400 : 502 });
  }
}
