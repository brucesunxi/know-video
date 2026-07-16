import { NextResponse } from "next/server";
import { getSql, hasDatabaseUrl } from "@/lib/db";
import { assetUrlForKey, uploadToR2 } from "@/lib/r2";
import type { AssetType } from "@/lib/types";

const MAX_UPLOAD_BYTES = 4_000_000;

function assetType(contentType: string): AssetType | undefined {
  if (contentType.startsWith("audio/")) return "audio";
  if (contentType.startsWith("video/")) return "clip";
  if (contentType.startsWith("image/")) return "image";
  return undefined;
}

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请选择要上传的图片、视频或音频。" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "当前单个素材请控制在 4MB 以内。" }, { status: 413 });
  }
  const type = assetType(file.type);
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
  const id = crypto.randomUUID();
  const url = assetUrlForKey(asset.key, asset.publicUrl);
  const metadata = {
    name: file.name,
    size: file.size,
    contentType: file.type,
    source: "user-upload"
  };

  if (hasDatabaseUrl() && versionId && Number.isInteger(sceneNumber) && sceneNumber > 0) {
    const sql = getSql();
    const scenes = await sql`
      select s.id
      from scenes s
      join project_versions pv on pv.id = s.version_id
      where s.version_id = ${versionId}
        and s.scene_number = ${sceneNumber}
        and pv.project_id = ${projectId}
      limit 1
    ` as Array<{ id: string }>;
    const sceneId = scenes[0]?.id;
    if (!sceneId) return NextResponse.json({ error: "没有找到要绑定素材的场景。" }, { status: 404 });
    await sql`delete from scene_assets where scene_id = ${sceneId} and asset_type = ${type}`;
    await sql`
      insert into scene_assets (id, scene_id, asset_type, r2_key, public_url, metadata_json)
      values (${id}, ${sceneId}, ${type}, ${asset.key}, ${url}, ${JSON.stringify(metadata)})
    `;
  }

  return NextResponse.json({
    asset: {
      id,
      type,
      url,
      r2Key: asset.key,
      metadata
    }
  });
}
