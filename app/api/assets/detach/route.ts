import { NextResponse } from "next/server";
import { z } from "zod";
import { assertProjectOwner, authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { detachSceneAsset } from "@/lib/scene-assets";

const schema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid(),
  sceneNumber: z.number().int().positive(),
  assetId: z.string().uuid()
});

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    const body = schema.parse(await request.json());
    await assertProjectOwner(body.projectId, user.id);
    const result = await detachSceneAsset(body);
    return result.detached
      ? NextResponse.json({ ok: true, preserveRender: result.preserveRender })
      : NextResponse.json({ error: "没有找到要移除的场景素材。" }, { status: 404 });
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
      return NextResponse.json({ error: "没有找到要移除素材的项目。" }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : "无法移除场景素材。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
