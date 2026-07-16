import { getSql, hasDatabaseUrl } from "@/lib/db";
import { assetUrlForKey } from "@/lib/r2";
import type { AssetType, SceneAsset } from "@/lib/types";

export function uploadedAssetType(contentType: string): AssetType | undefined {
  if (contentType.startsWith("audio/")) return "audio";
  if (contentType.startsWith("video/")) return "clip";
  if (contentType.startsWith("image/")) return "image";
  return undefined;
}

export async function findOwnedScene(input: {
  projectId: string;
  versionId: string;
  sceneNumber: number;
}) {
  if (!hasDatabaseUrl()) return undefined;
  const rows = await getSql()`
    select s.id
    from scenes s
    join project_versions pv on pv.id = s.version_id
    where s.version_id = ${input.versionId}
      and s.scene_number = ${input.sceneNumber}
      and pv.project_id = ${input.projectId}
    limit 1
  ` as Array<{ id: string }>;
  return rows[0]?.id;
}

export function createUploadedAsset(input: {
  key: string;
  name: string;
  size: number;
  contentType: string;
}): SceneAsset {
  const type = uploadedAssetType(input.contentType);
  if (!type) throw new Error("Unsupported asset type");
  return {
    id: crypto.randomUUID(),
    type,
    r2Key: input.key,
    url: assetUrlForKey(input.key),
    metadata: {
      name: input.name,
      size: input.size,
      contentType: input.contentType,
      source: "user-upload"
    }
  };
}

export async function attachUploadedAsset(input: {
  projectId: string;
  versionId: string;
  sceneNumber: number;
  asset: SceneAsset;
}) {
  if (!hasDatabaseUrl()) return;
  const sceneId = await findOwnedScene(input);
  if (!sceneId) throw new Error("没有找到要绑定素材的场景。");
  const sql = getSql();
  await sql`delete from scene_assets where scene_id = ${sceneId} and asset_type = ${input.asset.type}`;
  await sql`
    insert into scene_assets (id, scene_id, asset_type, r2_key, public_url, metadata_json)
    values (
      ${input.asset.id},
      ${sceneId},
      ${input.asset.type},
      ${input.asset.r2Key},
      ${input.asset.url},
      ${JSON.stringify(input.asset.metadata ?? {})}
    )
  `;
}

export async function detachSceneAsset(input: {
  projectId: string;
  versionId: string;
  sceneNumber: number;
  assetId: string;
}) {
  if (!hasDatabaseUrl()) return true;
  const rows = await getSql()`
    delete from scene_assets sa
    using scenes s, project_versions pv
    where sa.id = ${input.assetId}
      and sa.scene_id = s.id
      and s.version_id = ${input.versionId}
      and s.scene_number = ${input.sceneNumber}
      and pv.id = s.version_id
      and pv.project_id = ${input.projectId}
    returning sa.id
  ` as Array<{ id: string }>;
  return Boolean(rows[0]);
}
