import { NextResponse } from "next/server";
import { assetUrlForKey, uploadToR2 } from "@/lib/r2";
import { attachUploadedAsset, createUploadedAsset, uploadedAssetType } from "@/lib/scene-assets";

const MAX_UPLOAD_BYTES = 4_000_000;

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请选择要上传的图片、视频或音频。" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "当前单个素材请控制在 4MB 以内。" }, { status: 413 });
  }
  const type = uploadedAssetType(file.type);
  if (!type) return NextResponse.json({ error: "暂不支持这种素材格式。" }, { status: 415 });

  const projectId = String(form.get("projectId") ?? "unassigned");
  const versionId = String(form.get("versionId") ?? "");
  const sceneNumber = Number(form.get("sceneNumber"));
  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const key = `uploads/${projectId}/${crypto.randomUUID()}-${safeName}`;
  const asset = await uploadToR2({
    key,
    body: buffer,
    contentType: file.type || "application/octet-stream"
  });
  const uploadedAsset = createUploadedAsset({
    key: asset.key,
    name: file.name,
    size: file.size,
    contentType: file.type
  });
  uploadedAsset.url = assetUrlForKey(asset.key, asset.publicUrl);
  await attachUploadedAsset({ projectId, versionId, sceneNumber, asset: uploadedAsset });

  return NextResponse.json({ asset: uploadedAsset });
}
