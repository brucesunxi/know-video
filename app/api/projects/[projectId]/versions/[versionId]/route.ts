import { NextResponse } from "next/server";
import { z } from "zod";
import { authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { loadProjectVersionPreview } from "@/lib/project-mutations";

const schema = z.object({
  projectId: z.string().min(1).max(200),
  versionId: z.string().min(1).max(200)
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; versionId: string }> }
) {
  try {
    const user = await requireCurrentUser();
    const params = schema.parse(await context.params);
    const preview = await loadProjectVersionPreview(params.projectId, params.versionId, user.id);
    if (!preview) return NextResponse.json({ error: "版本不存在或不属于当前项目。" }, { status: 404 });
    return NextResponse.json(preview);
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    if (error instanceof z.ZodError) return NextResponse.json({ error: "版本预览请求无效。" }, { status: 400 });
    console.error(error);
    return NextResponse.json({ error: "版本预览读取失败。" }, { status: 500 });
  }
}
