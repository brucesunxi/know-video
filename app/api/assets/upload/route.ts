import { NextResponse } from "next/server";
import { z } from "zod";
import { matchesDeclaredAssetType, uploadedAssetType } from "@/lib/asset-policy";
import { assetUrlForKey, deleteR2Objects, uploadToR2 } from "@/lib/r2";
import { attachUploadedAsset, createUploadedAsset, findOwnedScene } from "@/lib/scene-assets";

const MAX_UPLOAD_BYTES = 4_000_000;
const fieldsSchema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid(),
  sceneNumber: z.coerce.number().int().positive()
});

export async function POST(request: Request) {
  try {
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
      sceneNumber: form.get("sceneNumber")
    });
    const sceneId = await findOwnedScene(fields);
    if (!sceneId) return NextResponse.json({ error: "没有找到要绑定素材的场景。" }, { status: 404 });

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!matchesDeclaredAssetType(buffer, file.type)) {
      return NextResponse.json({ error: "文件内容与声明的素材格式不一致。" }, { status: 415 });
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const key = `uploads/${fields.projectId}/${crypto.randomUUID()}-${safeName}`;
    const asset = await uploadToR2({ key, body: buffer, contentType: file.type });
    const uploadedAsset = createUploadedAsset({
      key: asset.key,
      name: file.name,
      size: file.size,
      contentType: file.type
    });
    uploadedAsset.url = assetUrlForKey(asset.key, asset.publicUrl);
    try {
      await attachUploadedAsset({ ...fields, asset: uploadedAsset });
    } catch (error) {
      await deleteR2Objects([key]).catch(() => undefined);
      throw error;
    }

    return NextResponse.json({ asset: uploadedAsset });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? "素材所属的项目或场景信息无效。"
      : error instanceof Error
        ? error.message
        : "素材上传失败。";
    return NextResponse.json({ error: message }, { status: error instanceof z.ZodError ? 400 : 502 });
  }
}
