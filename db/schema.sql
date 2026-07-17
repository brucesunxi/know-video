create extension if not exists "uuid-ossp";

create table if not exists projects (
  id uuid primary key default uuid_generate_v4(),
  user_id text,
  title text not null,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists project_versions (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  parent_version_id uuid references project_versions(id) on delete set null,
  status text not null check (status in ('draft', 'planning', 'rendering', 'ready', 'failed')),
  scene_plan_json jsonb not null,
  render_url text,
  thumbnail_url text,
  duration_seconds integer not null default 0,
  created_from_message_id uuid,
  created_at timestamptz not null default now()
);

alter table projects
  drop constraint if exists projects_current_version_fk;

alter table projects
  add constraint projects_current_version_fk
  foreign key (current_version_id)
  references project_versions(id)
  on delete set null;

create table if not exists scenes (
  id uuid primary key default uuid_generate_v4(),
  version_id uuid not null references project_versions(id) on delete cascade,
  scene_number integer not null,
  title text not null,
  voiceover text not null,
  visual_prompt text not null,
  motion_prompt text not null,
  duration_seconds integer not null,
  style_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique(version_id, scene_number)
);

create table if not exists scene_assets (
  id uuid primary key default uuid_generate_v4(),
  scene_id uuid not null references scenes(id) on delete cascade,
  asset_type text not null check (asset_type in ('image', 'audio', 'clip', 'thumbnail', 'caption', 'render')),
  r2_key text not null,
  public_url text,
  metadata_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table scene_assets
  drop constraint if exists scene_assets_asset_type_check;

alter table scene_assets
  add constraint scene_assets_asset_type_check
  check (asset_type in ('image', 'audio', 'clip', 'thumbnail', 'caption', 'render', 'logo', 'music'));

create table if not exists chat_messages (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  version_id uuid references project_versions(id) on delete set null,
  role text not null check (role in ('user', 'assistant', 'system')),
  message_type text not null check (message_type in ('text', 'plan', 'confirmation', 'version', 'system')),
  content text not null,
  metadata_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists edit_plans (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  base_version_id uuid not null references project_versions(id) on delete cascade,
  user_message_id uuid references chat_messages(id) on delete set null,
  status text not null check (status in ('proposed', 'approved', 'rejected', 'applied')),
  summary text not null,
  affected_scenes_json jsonb not null default '[]',
  patch_json jsonb not null,
  preview_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists render_jobs (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  version_id uuid not null references project_versions(id) on delete cascade,
  status text not null check (status in ('queued', 'running', 'ready', 'failed', 'cancelled')),
  progress integer not null default 0,
  error text,
  output_r2_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists generation_requests (
  id uuid primary key,
  request_fingerprint text not null,
  status text not null check (status in ('pending', 'ready', 'failed')),
  project_id uuid references projects(id) on delete set null,
  engine text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_versions_project_id_idx on project_versions(project_id);
create index if not exists scenes_version_id_idx on scenes(version_id);
create index if not exists chat_messages_project_id_idx on chat_messages(project_id);
create index if not exists edit_plans_project_id_idx on edit_plans(project_id);
create index if not exists render_jobs_version_id_idx on render_jobs(version_id);
create index if not exists render_jobs_version_status_idx on render_jobs(version_id, status, created_at desc);
create index if not exists generation_requests_status_updated_idx on generation_requests(status, updated_at desc);
