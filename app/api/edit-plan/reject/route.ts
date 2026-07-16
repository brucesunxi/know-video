import { NextResponse } from "next/server";
import { z } from "zod";
import { rejectPersistedEditPlan } from "@/lib/project-mutations";

const schema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid(),
  editPlanId: z.string().uuid()
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const message = await rejectPersistedEditPlan(body);
    return NextResponse.json({ message });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? "修改方案信息无效，请刷新后重试。"
      : error instanceof Error
        ? error.message
        : "取消修改方案失败。";
    return NextResponse.json({ error: message }, { status: error instanceof z.ZodError ? 400 : 409 });
  }
}
