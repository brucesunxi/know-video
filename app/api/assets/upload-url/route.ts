import { NextResponse } from "next/server";
import { z } from "zod";
import { maxUploadBytes, uploadedAssetType } from "@/lib/asset-policy";
import { createPresignedUpload } from "@/lib/r2";
import { findOwnedScene } from "@/lib/scene-assets";

const schema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid(),
  sceneNumber: z.number().int().positive(),
  name: z.string().min(1).max(240),
  size: z.number().int().positive().max(500_000_000),
  contentType: z.string().min(1).max(120)
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    if (!uploadedAssetType(body.contentType)) {
      return NextResponse.json({ error: "暂不支持这种素材格式。" }, { status: 415 });
    }
    if (body.size > maxUploadBytes(body.contentType)) {
      return NextResponse.json({ error: "素材文件超过该格式允许的大小。" }, { status: 413 });
    }
    const sceneId = await findOwnedScene(body);
    if (!sceneId) return NextResponse.json({ error: "没有找到要绑定素材的场景。" }, { status: 404 });
    const safeName = body.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const key = `uploads/${body.projectId}/${crypto.randomUUID()}-${safeName}`;
    const uploadUrl = await createPresignedUpload({ key, contentType: body.contentType });
    return NextResponse.json({ key, uploadUrl, expiresInSeconds: 900 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法开始素材上传。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
