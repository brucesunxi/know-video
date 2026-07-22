import { NextResponse } from "next/server";
import { z } from "zod";
import { assertProjectOwner, authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { maxUploadBytes, uploadedAssetType } from "@/lib/asset-policy";
import { findOwnedVersionAnchor } from "@/lib/production-assets";
import { createPresignedUpload } from "@/lib/r2";

const schema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid(),
  type: z.enum(["logo", "music"]),
  name: z.string().min(1).max(240),
  size: z.number().int().positive().max(80_000_000),
  contentType: z.string().min(1).max(120)
});

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    const body = schema.parse(await request.json());
    await assertProjectOwner(body.projectId, user.id);
    const uploadedType = uploadedAssetType(body.contentType);
    if ((body.type === "logo" && uploadedType !== "image") || (body.type === "music" && uploadedType !== "audio")) {
      return NextResponse.json({ error: body.type === "logo" ? "Logo 仅支持 PNG、JPEG 或 WebP。" : "背景音乐仅支持 MP3 或 WAV。" }, { status: 415 });
    }
    if (body.size > maxUploadBytes(body.contentType)) {
      return NextResponse.json({ error: "成片素材文件过大。" }, { status: 413 });
    }
    if (!await findOwnedVersionAnchor(body)) {
      return NextResponse.json({ error: "没有找到当前视频版本。" }, { status: 404 });
    }
    const safeName = body.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const key = `uploads/${body.projectId}/production/${body.type}/${crypto.randomUUID()}-${safeName}`;
    const uploadUrl = await createPresignedUpload({ key, contentType: body.contentType });
    return NextResponse.json({ key, uploadUrl, expiresInSeconds: 900 });
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
      return NextResponse.json({ error: "没有找到当前视频项目。" }, { status: 404 });
    }
    return NextResponse.json({ error: error instanceof z.ZodError ? "成片素材信息无效。" : "无法开始成片素材上传。" }, { status: 400 });
  }
}
