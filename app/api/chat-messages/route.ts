import { NextResponse } from "next/server";
import { z } from "zod";
import { assertProjectOwner, authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { persistAssistantMessage } from "@/lib/project-mutations";

const requestSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().min(1).max(200),
  versionId: z.string().min(1).max(200),
  content: z.string().trim().min(1).max(2000)
});

export async function POST(request: Request) {
  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof z.ZodError ? "制作记录格式无效。" : "无法读取制作记录。" },
      { status: 400 }
    );
  }

  try {
    const user = await requireCurrentUser();
    await assertProjectOwner(body.projectId, user.id);
    const message = await persistAssistantMessage(body);
    return NextResponse.json({ message });
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
      return NextResponse.json({ error: "项目不存在或已经被删除。" }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : "制作记录保存失败。";
    return NextResponse.json(
      { error: message },
      { status: /版本已经发生变化/.test(message) ? 409 : 502 }
    );
  }
}
