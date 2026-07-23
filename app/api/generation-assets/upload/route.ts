import { NextResponse } from "next/server";
import { z } from "zod";
import { authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { matchesDeclaredAssetType, maxUploadBytes, uploadedAssetType } from "@/lib/asset-policy";
import { assetUrlForKey, deleteR2Objects, uploadToR2 } from "@/lib/r2";

const fieldsSchema = z.object({
  requestId: z.string().uuid(),
  derivedFrom: z.string().min(1).max(240).optional(),
  referenceRole: z.literal("video-poster").optional(),
  actualDurationSeconds: z.preprocess(
    (value) => value === null || value === "" ? undefined : value,
    z.coerce.number().positive().max(21_600).optional()
  )
}).superRefine((value, context) => {
  if (value.referenceRole === "video-poster" && !value.derivedFrom) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "视频关键帧必须声明来源视频。" });
  }
});

export const maxDuration = 180;

export async function POST(request: Request) {
  let key: string | undefined;
  try {
    await requireCurrentUser();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请选择要上传的参考素材。" }, { status: 400 });
    }
    const fields = fieldsSchema.parse({
      requestId: form.get("requestId"),
      derivedFrom: form.get("derivedFrom") || undefined,
      referenceRole: form.get("referenceRole") || undefined,
      actualDurationSeconds: form.get("actualDurationSeconds")
    });
    const type = uploadedAssetType(file.type);
    if (!type) return NextResponse.json({ error: "暂不支持这种参考素材格式。" }, { status: 415 });
    if (file.size <= 0 || file.size > maxUploadBytes(file.type)) {
      return NextResponse.json({ error: "参考素材文件超过该格式允许的大小。" }, { status: 413 });
    }
    if (fields.actualDurationSeconds && type !== "clip") {
      return NextResponse.json({ error: "只有视频参考素材可以声明视频时长。" }, { status: 400 });
    }
    if (fields.referenceRole === "video-poster" && type !== "image") {
      return NextResponse.json({ error: "视频关键帧必须是图片。" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!matchesDeclaredAssetType(buffer.subarray(0, Math.min(buffer.length, 64)), file.type)) {
      return NextResponse.json({ error: "文件内容与声明的参考素材格式不一致。" }, { status: 415 });
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    key = `uploads/generation/${fields.requestId}/${crypto.randomUUID()}-${safeName}`;
    const uploaded = await uploadToR2({ key, body: buffer, contentType: file.type });
    return NextResponse.json({
      key: uploaded.key,
      url: assetUrlForKey(uploaded.key, uploaded.publicUrl),
      name: file.name,
      size: file.size,
      contentType: file.type,
      derivedFrom: fields.derivedFrom,
      referenceRole: fields.referenceRole,
      actualDurationSeconds: fields.actualDurationSeconds
    });
  } catch (error) {
    if (key) await deleteR2Objects([key]).catch(() => undefined);
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    const message = error instanceof z.ZodError
      ? "参考素材信息无效。"
      : error instanceof Error
        ? error.message
        : "参考素材上传失败。";
    return NextResponse.json({ error: message }, { status: error instanceof z.ZodError ? 400 : 502 });
  }
}
