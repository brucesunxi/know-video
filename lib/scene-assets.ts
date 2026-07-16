import { getSql, hasDatabaseUrl } from "@/lib/db";
import { uploadedAssetType } from "@/lib/asset-policy";
import { assetUrlForKey, deleteR2Objects } from "@/lib/r2";
import { invalidateVersionRender } from "@/lib/render-jobs";
import type { SceneAsset } from "@/lib/types";

export { uploadedAssetType } from "@/lib/asset-policy";

export async function deleteUnreferencedAssetObjects(keys: string[]) {
  const unique = Array.from(new Set(keys.filter(Boolean)));
  if (unique.length === 0) return;
  if (!hasDatabaseUrl()) {
    await deleteR2Objects(unique);
    return;
  }
  const rows = await getSql()`
    select candidate.key
    from unnest(${unique}::text[]) as candidate(key)
    where not exists (
      select 1
      from scene_assets
      where scene_assets.r2_key = candidate.key
    )
      and not exists (
        select 1
        from render_jobs
        where render_jobs.output_r2_key = candidate.key
      )
  ` as Array<{ key: string }>;
  await deleteR2Objects(rows.map((row) => row.key));
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
  const replaced = await sql`
    with replaced as (
      delete from scene_assets
      where scene_id = ${sceneId} and asset_type = ${input.asset.type}
      returning r2_key
    ),
    inserted as (
      insert into scene_assets (id, scene_id, asset_type, r2_key, public_url, metadata_json)
      values (
        ${input.asset.id},
        ${sceneId},
        ${input.asset.type},
        ${input.asset.r2Key},
        ${input.asset.url},
        ${JSON.stringify(input.asset.metadata ?? {})}
      )
      returning id
    )
    select r2_key from replaced
  ` as Array<{ r2_key: string }>;
  await invalidateVersionRender(input.versionId);
  await deleteUnreferencedAssetObjects(replaced.map((asset) => asset.r2_key)).catch((error) => {
    console.error("[scene-assets] Unable to clean replaced objects:", error);
  });
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
    returning sa.id, sa.r2_key
  ` as Array<{ id: string; r2_key: string }>;
  if (rows[0]) await invalidateVersionRender(input.versionId);
  if (rows[0]) {
    await deleteUnreferencedAssetObjects([rows[0].r2_key]).catch((error) => {
      console.error("[scene-assets] Unable to clean detached object:", error);
    });
  }
  return Boolean(rows[0]);
}
