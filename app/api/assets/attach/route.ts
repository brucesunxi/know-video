import { NextResponse } from "next/server";
import { z } from "zod";
import { matchesDeclaredAssetType, maxUploadBytes, uploadedAssetType } from "@/lib/asset-policy";
import { headR2Object, readR2Prefix } from "@/lib/r2";
import {
  attachUploadedAsset,
  createUploadedAsset,
  deleteUnreferencedAssetObjects,
  findOwnedScene
} from "@/lib/scene-assets";

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
  let uploadedKey: string | undefined;
  let ownsUploadedKey = false;
  const cleanupUpload = async () => {
    if (uploadedKey && ownsUploadedKey) {
      await deleteUnreferencedAssetObjects([uploadedKey]).catch(() => undefined);
    }
  };
  try {
    const body = schema.parse(await request.json());
    uploadedKey = body.key;
    if (!body.key.startsWith(`uploads/${body.projectId}/`)) {
      return NextResponse.json({ error: "素材上传路径无效。" }, { status: 403 });
    }
    ownsUploadedKey = true;
    if (!uploadedAssetType(body.contentType)) {
      await cleanupUpload();
      return NextResponse.json({ error: "暂不支持这种素材格式。" }, { status: 415 });
    }
    if (body.size > maxUploadBytes(body.contentType)) {
      await cleanupUpload();
      return NextResponse.json({ error: "素材文件超过该格式允许的大小。" }, { status: 413 });
    }
    if (!await findOwnedScene(body)) {
      await cleanupUpload();
      return NextResponse.json({ error: "没有找到要绑定素材的场景。" }, { status: 404 });
    }
    const stored = await headR2Object(body.key);
    if (stored.contentLength !== body.size || stored.contentType !== body.contentType) {
      await cleanupUpload();
      return NextResponse.json({ error: "云端素材的大小或格式校验失败。" }, { status: 409 });
    }
    const prefix = await readR2Prefix(body.key);
    if (!matchesDeclaredAssetType(prefix, body.contentType)) {
      await cleanupUpload();
      return NextResponse.json({ error: "文件内容与声明的素材格式不一致。" }, { status: 415 });
    }
    const asset = createUploadedAsset(body);
    await attachUploadedAsset({ ...body, asset });
    return NextResponse.json({ asset });
  } catch (error) {
    await cleanupUpload();
    const invalidRequest = error instanceof z.ZodError;
    const message = invalidRequest ? "场景素材信息无效。" : error instanceof Error ? error.message : "无法绑定场景素材。";
    return NextResponse.json({ error: message }, { status: invalidRequest ? 400 : 502 });
  }
}
