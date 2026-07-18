import { getSql, hasDatabaseUrl } from "@/lib/db";
import { referenceDescriptor } from "@/lib/attachment-context";
import { replacementAssetTypes, uploadedAssetType } from "@/lib/asset-policy";
import { assetUrlForKey } from "@/lib/r2";
import { invalidateVersionRender } from "@/lib/render-jobs";
import { deleteUnreferencedStorageObjects } from "@/lib/storage-cleanup";
import type { SceneAsset } from "@/lib/types";

export { uploadedAssetType } from "@/lib/asset-policy";
export { deleteUnreferencedStorageObjects as deleteUnreferencedAssetObjects } from "@/lib/storage-cleanup";

export async function findOwnedScene(input: {
  projectId: string;
  versionId: string;
  sceneNumber: number;
}) {
  return (await findOwnedSceneDetails(input))?.id;
}

export async function findOwnedSceneDetails(input: {
  projectId: string;
  versionId: string;
  sceneNumber: number;
}) {
  if (!hasDatabaseUrl()) return undefined;
  const rows = await getSql()`
    select s.id, s.duration_seconds
    from scenes s
    join project_versions pv on pv.id = s.version_id
    join projects p on p.id = pv.project_id
    where s.version_id = ${input.versionId}
      and s.scene_number = ${input.sceneNumber}
      and pv.project_id = ${input.projectId}
      and p.current_version_id = ${input.versionId}
    limit 1
  ` as Array<{ id: string; duration_seconds: number }>;
  const row = rows[0];
  return row ? { id: row.id, durationSeconds: row.duration_seconds } : undefined;
}

export function createUploadedAsset(input: {
  key: string;
  name: string;
  size: number;
  contentType: string;
  analysis?: string;
  analysisKind?: "visual" | "transcript";
  actualDurationSeconds?: number;
  transcriptionModel?: string;
  derivedFrom?: string;
  referenceRole?: "video-poster";
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
      source: "user-upload",
      analysis: input.analysis,
      analysisKind: input.analysisKind,
      actualDurationSeconds: input.actualDurationSeconds,
      transcriptionModel: input.transcriptionModel,
      derivedFrom: input.derivedFrom,
      referenceRole: input.referenceRole
    }
  };
}

export async function attachUploadedAsset(input: {
  projectId: string;
  versionId: string;
  sceneNumber: number;
  asset: SceneAsset;
  voiceover?: string;
}) {
  if (!hasDatabaseUrl()) return;
  const sceneId = await findOwnedScene(input);
  if (!sceneId) throw new Error("没有找到要绑定素材的场景。");
  const sql = getSql();
  const replacementTypes = replacementAssetTypes(input.asset.type);
  const reference = referenceDescriptor(input.asset);
  const replaced = await sql`
    with replaced as (
      delete from scene_assets
      where scene_id = ${sceneId}
        and asset_type in (${replacementTypes[0]}, ${replacementTypes[1] ?? replacementTypes[0]})
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
    ),
    remembered_reference as (
      update scenes
      set
        voiceover = coalesce(${input.voiceover ?? null}, voiceover),
        style_json = jsonb_set(
          style_json,
          '{referenceAssets}',
          case
            when exists (
              select 1
              from jsonb_array_elements(coalesce(style_json->'referenceAssets', '[]'::jsonb)) as existing
              where existing->>'key' = ${reference.key}
            ) then coalesce(style_json->'referenceAssets', '[]'::jsonb)
            else coalesce(style_json->'referenceAssets', '[]'::jsonb) || ${JSON.stringify([reference])}::jsonb
          end,
          true
        )
      where id = ${sceneId}
      returning id
    )
    select r2_key from replaced
  ` as Array<{ r2_key: string }>;
  await invalidateVersionRender(input.versionId);
  await deleteUnreferencedStorageObjects(replaced.map((asset) => asset.r2_key)).catch((error) => {
    console.error("[scene-assets] Unable to clean replaced objects:", error);
  });
}

export async function detachSceneAsset(input: {
  projectId: string;
  versionId: string;
  sceneNumber: number;
  assetId: string;
}) {
  if (!hasDatabaseUrl()) return { detached: true, preserveRender: false };
  const rows = await getSql()`
    with deleted as (
      delete from scene_assets sa
      using scenes s, project_versions pv, projects p
      where sa.id = ${input.assetId}
        and sa.scene_id = s.id
        and s.version_id = ${input.versionId}
        and s.scene_number = ${input.sceneNumber}
        and pv.id = s.version_id
        and pv.project_id = ${input.projectId}
        and p.id = pv.project_id
        and p.current_version_id = ${input.versionId}
      returning sa.id, sa.scene_id, sa.r2_key, sa.asset_type, sa.metadata_json
    ),
    forgotten_reference as (
      update scenes s
      set style_json = jsonb_set(
        s.style_json,
        '{referenceAssets}',
        coalesce((
          select jsonb_agg(ref)
          from jsonb_array_elements(coalesce(s.style_json->'referenceAssets', '[]'::jsonb)) as ref
          where ref->>'key' <> deleted.r2_key
        ), '[]'::jsonb),
        true
      )
      from deleted
      where s.id = deleted.scene_id
        and deleted.metadata_json->>'source' = 'user-upload'
      returning s.id
    )
    select id, r2_key, asset_type, metadata_json from deleted
  ` as Array<{ id: string; r2_key: string; asset_type: string; metadata_json: Record<string, unknown> | null }>;
  const preserveRender = rows[0]?.asset_type === "thumbnail" && rows[0]?.metadata_json?.candidate === true;
  if (rows[0] && !preserveRender) await invalidateVersionRender(input.versionId);
  if (rows[0]) {
    await deleteUnreferencedStorageObjects([rows[0].r2_key]).catch((error) => {
      console.error("[scene-assets] Unable to clean detached object:", error);
    });
  }
  return { detached: Boolean(rows[0]), preserveRender };
}
