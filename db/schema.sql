create extension if not exists "uuid-ossp";

create table if not exists users (
  id uuid primary key default uuid_generate_v4(),
  email text not null unique,
  name text,
  avatar_url text,
  provider text not null default 'google',
  provider_subject text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, provider_subject)
);

create table if not exists auth_sessions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists oauth_states (
  id uuid primary key default uuid_generate_v4(),
  state_hash text not null unique,
  redirect_to text not null default '/',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key default uuid_generate_v4(),
  user_id text,
  title text not null,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists auth_sessions_user_id_idx on auth_sessions(user_id);
create index if not exists auth_sessions_expires_at_idx on auth_sessions(expires_at);
create index if not exists oauth_states_expires_at_idx on oauth_states(expires_at);

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
  metadata_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table render_jobs
  add column if not exists metadata_json jsonb not null default '{}';

create table if not exists generation_requests (
  id uuid primary key,
  user_id uuid references users(id) on delete cascade,
  prompt text,
  request_fingerprint text not null,
  status text not null check (status in ('pending', 'ready', 'failed')),
  project_id uuid references projects(id) on delete set null,
  engine text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table generation_requests
  add column if not exists user_id uuid references users(id) on delete cascade;

alter table generation_requests
  add column if not exists prompt text;

create index if not exists project_versions_project_id_idx on project_versions(project_id);
create index if not exists projects_user_id_updated_idx on projects(user_id, updated_at desc);
create index if not exists scenes_version_id_idx on scenes(version_id);
create index if not exists chat_messages_project_id_idx on chat_messages(project_id);
create index if not exists edit_plans_project_id_idx on edit_plans(project_id);
create index if not exists render_jobs_version_id_idx on render_jobs(version_id);
create index if not exists render_jobs_version_status_idx on render_jobs(version_id, status, created_at desc);
create index if not exists generation_requests_status_updated_idx on generation_requests(status, updated_at desc);
create index if not exists generation_requests_user_status_updated_idx on generation_requests(user_id, status, updated_at desc);

create table if not exists pricing_rules (
  id uuid primary key default uuid_generate_v4(),
  rule_key text not null unique,
  resource_type text not null,
  provider text not null,
  model text not null,
  billing_unit text not null,
  credits_per_unit integer not null check (credits_per_unit >= 0),
  provider_rate_json jsonb not null default '{}',
  exchange_rate numeric(12, 6) not null,
  retry_reserve_rate numeric(8, 6) not null,
  projected_margin_rate numeric(8, 6),
  effective_from timestamptz not null,
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  check (projected_margin_rate is null or projected_margin_rate >= 0.40)
);

create table if not exists usage_events (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete restrict,
  project_id uuid references projects(id) on delete set null,
  version_id uuid references project_versions(id) on delete set null,
  resource_type text not null,
  quantity numeric(16, 6) not null check (quantity > 0),
  provider text not null,
  model text not null,
  pricing_rule_id uuid not null references pricing_rules(id) on delete restrict,
  estimated_cost_microusd bigint not null check (estimated_cost_microusd >= 0),
  actual_cost_microusd bigint,
  reserved_credits bigint not null default 0,
  settled_credits bigint not null default 0,
  status text not null check (status in ('settled', 'released')),
  idempotency_key text not null unique,
  metadata_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  settled_at timestamptz not null default now()
);

create index if not exists pricing_rules_resource_effective_idx
  on pricing_rules(resource_type, effective_from desc);
create index if not exists usage_events_user_created_idx
  on usage_events(user_id, created_at desc);
create index if not exists usage_events_project_created_idx
  on usage_events(project_id, created_at desc);
create index if not exists usage_events_resource_created_idx
  on usage_events(resource_type, created_at desc);
