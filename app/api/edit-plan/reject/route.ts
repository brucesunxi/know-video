import { NextResponse } from "next/server";
import { z } from "zod";
import { assertProjectOwner, authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { rejectPersistedEditPlan } from "@/lib/project-mutations";

const schema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid(),
  editPlanId: z.string().uuid()
});

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    const body = schema.parse(await request.json());
    await assertProjectOwner(body.projectId, user.id);
    const message = await rejectPersistedEditPlan(body);
    return NextResponse.json({ message });
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
      return NextResponse.json({ error: "项目不存在或已经被删除。" }, { status: 404 });
    }
    const message = error instanceof z.ZodError
      ? "修改方案信息无效，请刷新后重试。"
      : error instanceof Error
        ? error.message
        : "取消修改方案失败。";
    return NextResponse.json({ error: message }, { status: error instanceof z.ZodError ? 400 : 409 });
  }
}
