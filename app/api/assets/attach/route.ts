import { NextResponse } from "next/server";
import { z } from "zod";
import { headR2Object } from "@/lib/r2";
import { attachUploadedAsset, createUploadedAsset } from "@/lib/scene-assets";

const schema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid(),
  sceneNumber: z.number().int().positive(),
  key: z.string().min(1).max(800),
  name: z.string().min(1).max(240),
  size: z.number().int().positive().max(500_000_000),
  contentType: z.string().min(1).max(120)
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    if (!body.key.startsWith(`uploads/${body.projectId}/`)) {
      return NextResponse.json({ error: "素材上传路径无效。" }, { status: 403 });
    }
    const stored = await headR2Object(body.key);
    if (stored.contentLength !== body.size || stored.contentType !== body.contentType) {
      return NextResponse.json({ error: "云端素材的大小或格式校验失败。" }, { status: 409 });
    }
    const asset = createUploadedAsset(body);
    await attachUploadedAsset({ ...body, asset });
    return NextResponse.json({ asset });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法绑定场景素材。";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
