import { getSql, hasDatabaseUrl } from "@/lib/db";
import { deleteR2Objects } from "@/lib/r2";

export async function deleteUnreferencedStorageObjects(keys: string[]) {
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
