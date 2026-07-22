import { NextResponse } from "next/server";
import { z } from "zod";
import { assertProjectOwner, authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { loadCurrentProjectForEdit } from "@/lib/project-mutations";
import { updateProductionSettings } from "@/lib/production-assets";

const schema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid(),
  settings: z.object({
    captionsEnabled: z.boolean().optional(),
    captionStyle: z.enum(["minimal", "boxed", "highlight"]).optional(),
    playbackRate: z.union([z.literal(0.75), z.literal(1), z.literal(1.25), z.literal(1.5)]).optional(),
    musicVolume: z.number().min(0).max(0.5).optional(),
    musicDucking: z.enum(["off", "balanced", "strong"]).optional(),
    logoPosition: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
    logoSize: z.number().min(6).max(24).optional()
  }).refine((settings) => Object.keys(settings).length > 0, "至少需要修改一项成片设置。")
});

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    const body = schema.parse(await request.json());
    await assertProjectOwner(body.projectId, user.id);
    await updateProductionSettings(body);
    const project = await loadCurrentProjectForEdit(body.projectId, body.versionId, user.id);
    if (!project) return NextResponse.json({ error: "视频版本已经发生变化，请刷新后重试。" }, { status: 409 });
    return NextResponse.json({ project });
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
      return NextResponse.json({ error: "没有找到当前视频项目。" }, { status: 404 });
    }
    return NextResponse.json({
      error: error instanceof z.ZodError ? "成片设置格式无效。" : error instanceof Error ? error.message : "成片设置保存失败。"
    }, { status: error instanceof z.ZodError ? 400 : 502 });
  }
}
