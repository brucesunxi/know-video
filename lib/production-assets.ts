import { getSql, hasDatabaseUrl } from "@/lib/db";
import { DEFAULT_PRODUCTION_SETTINGS, productionSettingsFromScenes } from "@/lib/production-settings";
import { assetUrlForKey } from "@/lib/r2";
import { invalidateVersionRender } from "@/lib/render-jobs";
import { deleteUnreferencedStorageObjects } from "@/lib/storage-cleanup";
import type { ProductionSettings, Scene, SceneAsset } from "@/lib/types";

type ProductionAssetType = "logo" | "music";

export async function findOwnedVersionAnchor(input: { projectId: string; versionId: string }) {
  if (!hasDatabaseUrl()) return undefined;
  const rows = await getSql()`
    select s.id, s.style_json
    from scenes s
    join project_versions pv on pv.id = s.version_id
    join projects p on p.id = pv.project_id
    where p.id = ${input.projectId}
      and p.current_version_id = ${input.versionId}
      and pv.id = ${input.versionId}
    order by s.scene_number asc
    limit 1
  ` as Array<{ id: string; style_json: unknown }>;
  return rows[0];
}

export function createProductionAsset(input: {
  key: string;
  name: string;
  size: number;
  contentType: string;
  type: ProductionAssetType;
}) {
  return {
    id: crypto.randomUUID(),
    type: input.type,
    r2Key: input.key,
    url: assetUrlForKey(input.key),
    metadata: {
      name: input.name,
      size: input.size,
      contentType: input.contentType,
      source: "user-upload",
      role: input.type
    }
  } satisfies SceneAsset;
}

export async function attachProductionAsset(input: {
  projectId: string;
  versionId: string;
  asset: SceneAsset;
}) {
  if (!hasDatabaseUrl()) return;
  if (input.asset.type !== "logo" && input.asset.type !== "music") throw new Error("成片素材类型无效。");
  const anchor = await findOwnedVersionAnchor(input);
  if (!anchor) throw new Error("没有找到当前视频版本。");
  const rows = await getSql()`
    with replaced as (
      delete from scene_assets
      where scene_id = ${anchor.id} and asset_type = ${input.asset.type}
      returning r2_key
    ),
    inserted as (
      insert into scene_assets (id, scene_id, asset_type, r2_key, public_url, metadata_json)
      values (
        ${input.asset.id},
        ${anchor.id},
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
  await deleteUnreferencedStorageObjects(rows.map((row) => row.r2_key)).catch((error) => {
    console.error("[production-assets] Unable to clean replaced asset:", error);
  });
}

export async function detachProductionAsset(input: {
  projectId: string;
  versionId: string;
  type: ProductionAssetType;
}) {
  if (!hasDatabaseUrl()) return false;
  const anchor = await findOwnedVersionAnchor(input);
  if (!anchor) return false;
  const rows = await getSql()`
    delete from scene_assets
    where scene_id = ${anchor.id} and asset_type = ${input.type}
    returning r2_key
  ` as Array<{ r2_key: string }>;
  if (!rows[0]) return false;
  await invalidateVersionRender(input.versionId);
  await deleteUnreferencedStorageObjects(rows.map((row) => row.r2_key)).catch((error) => {
    console.error("[production-assets] Unable to clean detached asset:", error);
  });
  return true;
}

export async function updateProductionSettings(input: {
  projectId: string;
  versionId: string;
  settings: Partial<ProductionSettings>;
}) {
  if (!hasDatabaseUrl()) return;
  const anchor = await findOwnedVersionAnchor(input);
  if (!anchor) throw new Error("没有找到当前视频版本。");
  const style = anchor.style_json && typeof anchor.style_json === "object"
    ? anchor.style_json as Scene["style"]
    : { theme: "premium dark", palette: ["#07111d", "#38d5e5"], mood: "focused" };
  const current = productionSettingsFromScenes([{ style } as Scene]);
  const next: ProductionSettings = { ...DEFAULT_PRODUCTION_SETTINGS, ...current, ...input.settings };
  await getSql()`
    update scenes
    set style_json = ${JSON.stringify({ ...style, production: next })}
    where id = ${anchor.id}
  `;
  await invalidateVersionRender(input.versionId);
}
