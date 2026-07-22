import { NextResponse } from "next/server";
import { z } from "zod";
import { assertProjectOwner, authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { matchesDeclaredAssetType, uploadedAssetType } from "@/lib/asset-policy";
import { assetUrlForKey, deleteR2Objects, uploadToR2 } from "@/lib/r2";
import { attachUploadedAsset, createUploadedAsset, findOwnedSceneDetails } from "@/lib/scene-assets";
import { inspectUploadedNarration } from "@/lib/uploaded-narration";

const MAX_UPLOAD_BYTES = 4_000_000;
const fieldsSchema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid(),
  sceneNumber: z.coerce.number().int().positive(),
  actualDurationSeconds: z.preprocess(
    (value) => value === null || value === "" ? undefined : value,
    z.coerce.number().positive().max(21_600).optional()
  )
});

export const maxDuration = 180;

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请选择要上传的图片、视频或音频。" }, { status: 400 });
    }
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "当前单个素材请控制在 4MB 以内。" }, { status: 413 });
    }
    const type = uploadedAssetType(file.type);
    if (!type) return NextResponse.json({ error: "暂不支持这种素材格式。" }, { status: 415 });
    const fields = fieldsSchema.parse({
      projectId: form.get("projectId"),
      versionId: form.get("versionId"),
      sceneNumber: form.get("sceneNumber"),
      actualDurationSeconds: form.get("actualDurationSeconds")
    });
    await assertProjectOwner(fields.projectId, user.id);
    if (fields.actualDurationSeconds && type !== "clip") {
      return NextResponse.json({ error: "只有视频素材可以声明视频时长。" }, { status: 400 });
    }
    const scene = await findOwnedSceneDetails(fields);
    if (!scene) return NextResponse.json({ error: "没有找到要绑定素材的场景。" }, { status: 404 });

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!matchesDeclaredAssetType(buffer, file.type)) {
      return NextResponse.json({ error: "文件内容与声明的素材格式不一致。" }, { status: 415 });
    }
    const narration = type === "audio"
      ? await inspectUploadedNarration(buffer, scene.durationSeconds)
      : undefined;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const key = `uploads/${fields.projectId}/${crypto.randomUUID()}-${safeName}`;
    const asset = await uploadToR2({ key, body: buffer, contentType: file.type });
    const uploadedAsset = createUploadedAsset({
      key: asset.key,
      name: file.name,
      size: file.size,
      contentType: file.type,
      analysis: narration?.transcript,
      analysisKind: narration ? "transcript" : undefined,
      actualDurationSeconds: narration?.actualDurationSeconds ?? fields.actualDurationSeconds,
      transcriptionModel: narration?.transcriptionModel
    });
    uploadedAsset.url = assetUrlForKey(asset.key, asset.publicUrl);
    try {
      await attachUploadedAsset({ ...fields, asset: uploadedAsset, voiceover: narration?.transcript });
    } catch (error) {
      await deleteR2Objects([key]).catch(() => undefined);
      throw error;
    }

    return NextResponse.json({ asset: uploadedAsset, voiceover: narration?.transcript });
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
      return NextResponse.json({ error: "没有找到要绑定素材的项目。" }, { status: 404 });
    }
    const message = error instanceof z.ZodError
      ? "素材所属的项目或场景信息无效。"
      : error instanceof Error
        ? error.message
        : "素材上传失败。";
    return NextResponse.json({ error: message }, { status: error instanceof z.ZodError ? 400 : 502 });
  }
}
