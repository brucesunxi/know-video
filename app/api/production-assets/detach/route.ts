import { NextResponse } from "next/server";
import { z } from "zod";
import { assertProjectOwner, authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { loadCurrentProjectForEdit } from "@/lib/project-mutations";
import { detachProductionAsset } from "@/lib/production-assets";

const schema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid(),
  type: z.enum(["logo", "music"])
});

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    const body = schema.parse(await request.json());
    await assertProjectOwner(body.projectId, user.id);
    if (!await detachProductionAsset(body)) return NextResponse.json({ error: "没有找到要移除的成片素材。" }, { status: 404 });
    const project = await loadCurrentProjectForEdit(body.projectId, body.versionId, user.id);
    if (!project) return NextResponse.json({ error: "视频版本已经发生变化，请刷新后重试。" }, { status: 409 });
    return NextResponse.json({ project });
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
      return NextResponse.json({ error: "没有找到当前视频项目。" }, { status: 404 });
    }
    return NextResponse.json({ error: error instanceof z.ZodError ? "移除请求无效。" : "无法移除成片素材。" }, { status: 400 });
  }
}
