import { NextResponse } from "next/server";
import { z } from "zod";
import { authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { maxUploadBytes, uploadedAssetType } from "@/lib/asset-policy";
import { createPresignedUpload } from "@/lib/r2";

const schema = z.object({
  requestId: z.string().uuid(),
  name: z.string().min(1).max(240),
  size: z.number().int().positive().max(500_000_000),
  contentType: z.string().min(1).max(120)
});

export async function POST(request: Request) {
  try {
    await requireCurrentUser();
    const body = schema.parse(await request.json());
    if (!uploadedAssetType(body.contentType)) {
      return NextResponse.json({ error: "暂不支持这种参考素材格式。" }, { status: 415 });
    }
    if (body.size > maxUploadBytes(body.contentType)) {
      return NextResponse.json({ error: "参考素材文件超过该格式允许的大小。" }, { status: 413 });
    }
    const safeName = body.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const key = `uploads/generation/${body.requestId}/${crypto.randomUUID()}-${safeName}`;
    const uploadUrl = await createPresignedUpload({ key, contentType: body.contentType });
    return NextResponse.json({ key, uploadUrl, expiresInSeconds: 900 });
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    const message = error instanceof z.ZodError
      ? "参考素材信息无效。"
      : error instanceof Error ? error.message : "无法开始上传参考素材。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
