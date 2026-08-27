import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured.");
}

const sql = neon(process.env.DATABASE_URL);
const rows = await sql`
  select
    request.id,
    account.email,
    request.status,
    request.project_id,
    project.title,
    request.engine,
    request.created_at,
    request.updated_at,
    extract(epoch from (now() - request.created_at))::integer as age_seconds,
    extract(epoch from (now() - request.updated_at))::integer as heartbeat_age_seconds,
    reservation.status as reservation_status,
    reservation.reserved_credits,
    reservation.settled_credits,
    reservation.released_credits,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'sceneNumber', scene.scene_number,
          'hasVisual', exists (
            select 1
            from scene_assets visual
            where visual.scene_id = scene.id
              and visual.asset_type in ('image', 'clip')
              and coalesce(visual.metadata_json->>'source', '') <> 'fallback-image'
              and coalesce(visual.metadata_json->>'model', '') <> 'local-svg-fallback'
              and coalesce(visual.metadata_json->>'qualityFallback', 'false') <> 'true'
          ),
          'hasAudio', exists (
            select 1
            from scene_assets audio
            where audio.scene_id = scene.id
              and audio.asset_type = 'audio'
          ),
          'assetCount', (
            select count(*)::integer
            from scene_assets asset
            where asset.scene_id = scene.id
          )
        ) order by scene.scene_number
      )
      from scenes scene
      where scene.version_id = project.current_version_id
    ), '[]'::jsonb) as scene_progress
  from generation_requests request
  left join users account on account.id = request.user_id
  left join projects project on project.id = request.project_id
  left join credit_reservations reservation
    on reservation.reservation_key = 'project-generation:' || request.id::text
  where request.status = 'pending'
  order by request.updated_at desc
`;

function maskEmail(email) {
  if (!email || !email.includes("@")) return undefined;
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}***@${domain}`;
}

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  pendingCount: rows.length,
  tasks: rows.map((row) => ({
    id: row.id,
    account: maskEmail(row.email),
    title: row.title ?? "(project not attached)",
    projectId: row.project_id ?? undefined,
    engine: row.engine ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    ageMinutes: Math.round(Number(row.age_seconds) / 6) / 10,
    heartbeatAgeMinutes: Math.round(Number(row.heartbeat_age_seconds) / 6) / 10,
    reservation: row.reservation_status ? {
      status: row.reservation_status,
      reservedCredits: Number(row.reserved_credits),
      settledCredits: Number(row.settled_credits),
      releasedCredits: Number(row.released_credits)
    } : undefined,
    scenes: row.scene_progress
  }))
}, null, 2));
