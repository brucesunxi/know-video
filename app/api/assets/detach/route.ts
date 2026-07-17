import { NextResponse } from "next/server";
import { z } from "zod";
import { detachSceneAsset } from "@/lib/scene-assets";

const schema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid(),
  sceneNumber: z.number().int().positive(),
  assetId: z.string().uuid()
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const result = await detachSceneAsset(body);
    return result.detached
      ? NextResponse.json({ ok: true, preserveRender: result.preserveRender })
      : NextResponse.json({ error: "没有找到要移除的场景素材。" }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法移除场景素材。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
