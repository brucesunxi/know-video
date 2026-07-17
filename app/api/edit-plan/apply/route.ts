import { NextResponse } from "next/server";
import { z } from "zod";
import { editPlanObjectSchema } from "@/lib/edit-plan-schema";
import {
  applyPersistedEditPlan,
  loadCurrentProjectForEdit,
  loadProposedEditPlan
} from "@/lib/project-mutations";
import { persistSceneStructureMutation } from "@/lib/scene-structure-mutations";
import type { EditPlan } from "@/lib/types";

const requestSchema = z.object({
  projectId: z.string().min(1).max(200),
  versionId: z.string().min(1).max(200),
  direct: z.boolean().optional().default(false),
  editPlan: editPlanObjectSchema.extend({ status: z.literal("proposed") }).refine(
    (plan) => plan.changes.length > 0 || Object.keys(plan.productionSettings ?? {}).length > 0 || Boolean(plan.sceneStructure)
  )
});

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    if (body.editPlan.baseVersionId !== body.versionId) {
      return NextResponse.json({ error: "修改方案不是基于当前视频版本生成的，请重新规划。" }, { status: 409 });
    }
    if (body.direct && !z.string().uuid().safeParse(body.editPlan.id).success) {
      return NextResponse.json({ error: "直接编辑方案标识无效，请重试。" }, { status: 400 });
    }
    const project = await loadCurrentProjectForEdit(body.projectId, body.versionId);
    if (!project) {
      return NextResponse.json({ error: "视频版本已经发生变化，请刷新后重新修改。" }, { status: 409 });
    }
    const editPlan = body.direct
      ? body.editPlan as EditPlan
      : await loadProposedEditPlan({
        projectId: body.projectId,
        versionId: body.versionId,
        editPlanId: body.editPlan.id
      }) ?? (!process.env.DATABASE_URL ? body.editPlan as EditPlan : undefined);
    if (!editPlan) {
      return NextResponse.json({ error: "修改方案已经失效，请重新生成后再应用。" }, { status: 409 });
    }
    const sceneNumbers = new Set(project.currentVersion.scenes.map((scene) => scene.sceneNumber));
    if (editPlan.changes.some((change) => !sceneNumbers.has(change.sceneNumber))) {
      return NextResponse.json({ error: "修改方案包含当前版本中不存在的场景。" }, { status: 409 });
    }
    if (editPlan.sceneStructure) {
      if (!sceneNumbers.has(editPlan.sceneStructure.sceneNumber)) {
        return NextResponse.json({ error: "修改方案包含当前版本中不存在的场景。" }, { status: 409 });
      }
      if (editPlan.sceneStructure.operation === "move-to" && !sceneNumbers.has(editPlan.sceneStructure.targetSceneNumber)) {
        return NextResponse.json({ error: "修改方案包含当前版本中不存在的目标位置。" }, { status: 409 });
      }
      const structuralProject = editPlan.productionSettings ? {
        ...project,
        currentVersion: {
          ...project.currentVersion,
          scenes: project.currentVersion.scenes.map((scene, index) => index === 0 ? {
            ...scene,
            style: {
              ...scene.style,
              production: { ...scene.style.production, ...editPlan.productionSettings }
            }
          } : scene)
        }
      } : project;
      const structural = await persistSceneStructureMutation({
        project: structuralProject,
        mutation: editPlan.sceneStructure,
        editPlanId: body.direct ? undefined : editPlan.id
      });
      return NextResponse.json({
        ...structural,
        regeneration: structural.regeneration
      });
    }
    const result = await applyPersistedEditPlan({
      project,
      editPlan,
      direct: body.direct
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "修改方案格式无效，请重新生成。" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "应用修改失败。";
    const status = /已经失效|版本已经发生变化/.test(message)
      ? 409
      : /没有变化|边界|超出了|必须是|最多支持|至少需要|无法拆分|没有后一场景|合并后|首个场景|转场时长|候选画面/.test(message)
        ? 400
        : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
