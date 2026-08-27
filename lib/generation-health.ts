import { getSql, hasDatabaseUrl } from "@/lib/db";

export type GenerationHealthAudit = {
  generatedAt: string;
  pendingGenerations: Array<{
    id: string;
    email: string;
    projectId?: string;
    ageMinutes: number;
    createdAt: string;
    updatedAt: string;
  }>;
  recentFailedGenerations: Array<{
    id: string;
    email: string;
    projectId?: string;
    error?: string;
    updatedAt: string;
  }>;
  activeRenderJobs: Array<{
    id: string;
    projectId: string;
    status: "queued" | "running";
    progress: number;
    ageMinutes: number;
    error?: string;
  }>;
  openReservations: Array<{
    key: string;
    email: string;
    status: "reserved" | "partially_settled";
    remaining: number;
    expired: boolean;
    ageMinutes: number;
  }>;
  creditInvariantViolations: Array<{
    email: string;
    accountReserved: number;
    reservationOpen: number;
  }>;
  incompleteCurrentProjects: Array<{
    projectId: string;
    title: string;
    email: string;
    versionStatus: string;
    scenes: number;
    visuals: number;
    audio: number;
  }>;
  readyRequestsWithIncompleteMedia: Array<{
    requestId: string;
    projectId: string;
    title: string;
    scenes: number;
    visuals: number;
    audio: number;
  }>;
};

type StoredAudit = Omit<GenerationHealthAudit, "generatedAt">;

const EMPTY_AUDIT: StoredAudit = {
  pendingGenerations: [],
  recentFailedGenerations: [],
  activeRenderJobs: [],
  openReservations: [],
  creditInvariantViolations: [],
  incompleteCurrentProjects: [],
  readyRequestsWithIncompleteMedia: []
};

function normalizedAudit(value: Partial<StoredAudit> | undefined): StoredAudit {
  return Object.fromEntries(Object.entries(EMPTY_AUDIT).map(([key, fallback]) => [
    key,
    Array.isArray(value?.[key as keyof StoredAudit]) ? value?.[key as keyof StoredAudit] : fallback
  ])) as StoredAudit;
}

export async function readGenerationHealthAudit(): Promise<GenerationHealthAudit> {
  if (!hasDatabaseUrl()) return { generatedAt: new Date().toISOString(), ...EMPTY_AUDIT };
  const rows = await getSql()`
    with project_media as (
      select
        project.id as project_id,
        project.title,
        project.user_id,
        version.id as version_id,
        version.status as version_status,
        version.parent_version_id is null as initial_version,
        count(scene.id)::int as scene_count,
        count(scene.id) filter (
          where exists (
            select 1
            from scene_assets asset
            where asset.scene_id = scene.id
              and asset.asset_type in ('image', 'clip')
              and coalesce(asset.metadata_json ->> 'source', '') <> 'fallback-image'
              and coalesce(asset.metadata_json ->> 'model', '') <> 'local-svg-fallback'
              and coalesce(asset.metadata_json ->> 'qualityFallback', 'false') <> 'true'
          )
        )::int as visual_count,
        count(scene.id) filter (
          where exists (
            select 1
            from scene_assets asset
            where asset.scene_id = scene.id
              and asset.asset_type = 'audio'
          )
        )::int as audio_count
      from projects project
      join project_versions version on version.id = project.current_version_id
      left join scenes scene on scene.version_id = version.id
      group by project.id, project.title, project.user_id, version.id, version.status, version.parent_version_id
    ),
    reservation_totals as (
      select
        user_id,
        sum(reserved_credits - settled_credits - released_credits)::bigint as open_credits
      from credit_reservations
      where status in ('reserved', 'partially_settled')
      group by user_id
    )
    select jsonb_build_object(
      'pendingGenerations', coalesce((
        select jsonb_agg(item order by updated_at)
        from (
          select
            request.updated_at,
            jsonb_build_object(
              'id', request.id,
              'email', app_user.email,
              'projectId', request.project_id,
              'ageMinutes', round(extract(epoch from (now() - request.updated_at)) / 60, 1),
              'createdAt', request.created_at,
              'updatedAt', request.updated_at
            ) as item
          from generation_requests request
          left join users app_user on app_user.id = request.user_id
          where request.status = 'pending'
        ) pending
      ), '[]'::jsonb),
      'recentFailedGenerations', coalesce((
        select jsonb_agg(item order by updated_at desc)
        from (
          select
            request.updated_at,
            jsonb_build_object(
              'id', request.id,
              'email', app_user.email,
              'projectId', request.project_id,
              'error', request.error,
              'updatedAt', request.updated_at
            ) as item
          from generation_requests request
          left join users app_user on app_user.id = request.user_id
          where request.status = 'failed'
            and request.updated_at > now() - interval '7 days'
          order by request.updated_at desc
          limit 20
        ) recent_failures
      ), '[]'::jsonb),
      'activeRenderJobs', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', job.id,
          'projectId', job.project_id,
          'status', job.status,
          'progress', job.progress,
          'ageMinutes', round(extract(epoch from (now() - job.updated_at)) / 60, 1),
          'error', job.error
        ))
        from render_jobs job
        where job.status in ('queued', 'running')
      ), '[]'::jsonb),
      'openReservations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'key', reservation.reservation_key,
          'email', app_user.email,
          'status', reservation.status,
          'remaining', reservation.reserved_credits - reservation.settled_credits - reservation.released_credits,
          'expired', reservation.expires_at < now(),
          'ageMinutes', round(extract(epoch from (now() - reservation.updated_at)) / 60, 1)
        ))
        from credit_reservations reservation
        left join users app_user on app_user.id = reservation.user_id
        where reservation.status in ('reserved', 'partially_settled')
      ), '[]'::jsonb),
      'creditInvariantViolations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'email', app_user.email,
          'accountReserved', account.reserved_credits,
          'reservationOpen', coalesce(total.open_credits, 0)
        ))
        from credit_accounts account
        left join reservation_totals total on total.user_id = account.user_id
        left join users app_user on app_user.id = account.user_id
        where account.reserved_credits <> coalesce(total.open_credits, 0)
      ), '[]'::jsonb),
      'incompleteCurrentProjects', coalesce((
        select jsonb_agg(jsonb_build_object(
          'projectId', media.project_id,
          'title', media.title,
          'email', app_user.email,
          'versionStatus', media.version_status,
          'scenes', media.scene_count,
          'visuals', media.visual_count,
          'audio', media.audio_count
        ))
        from project_media media
        left join users app_user on app_user.id = media.user_id
        where media.scene_count = 0
          or media.visual_count < media.scene_count
          or media.audio_count < media.scene_count
      ), '[]'::jsonb),
      'readyRequestsWithIncompleteMedia', coalesce((
        select jsonb_agg(jsonb_build_object(
          'requestId', request.id,
          'projectId', request.project_id,
          'title', media.title,
          'scenes', media.scene_count,
          'visuals', media.visual_count,
          'audio', media.audio_count
        ))
        from generation_requests request
        join project_media media on media.project_id = request.project_id
        where request.status = 'ready'
          and media.initial_version
          and (
            media.scene_count = 0
            or media.visual_count < media.scene_count
            or media.audio_count < media.scene_count
          )
      ), '[]'::jsonb)
    ) as audit
  ` as Array<{ audit: Partial<StoredAudit> }>;
  return {
    generatedAt: new Date().toISOString(),
    ...normalizedAudit(rows[0]?.audit)
  };
}
