import { NextResponse } from "next/server";
import { z } from "zod";
import { loadCurrentProjectForEdit } from "@/lib/project-mutations";
import { detachProductionAsset } from "@/lib/production-assets";

const schema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid(),
  type: z.enum(["logo", "music"])
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    if (!await detachProductionAsset(body)) return NextResponse.json({ error: "没有找到要移除的成片素材。" }, { status: 404 });
    const project = await loadCurrentProjectForEdit(body.projectId, body.versionId);
    if (!project) return NextResponse.json({ error: "视频版本已经发生变化，请刷新后重试。" }, { status: 409 });
    return NextResponse.json({ project });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "移除请求无效。" : "无法移除成片素材。" }, { status: 400 });
  }
}
