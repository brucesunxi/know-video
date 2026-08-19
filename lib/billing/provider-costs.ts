import { getSql, hasDatabaseUrl } from "@/lib/db";

let schemaPromise: Promise<void> | undefined;

async function ensureProviderCostSchema() {
  if (!hasDatabaseUrl()) return;
  if (!schemaPromise) {
    schemaPromise = getSql()`
      create table if not exists provider_cost_events (
        id uuid primary key default uuid_generate_v4(),
        project_id uuid references projects(id) on delete set null,
        version_id uuid references project_versions(id) on delete set null,
        scene_number integer,
        provider text not null,
        model text not null,
        operation text not null,
        outcome text not null check (outcome in ('succeeded', 'failed')),
        cost_microusd bigint not null check (cost_microusd >= 0),
        cost_source text not null default 'catalog_estimate',
        idempotency_key text not null unique,
        metadata_json jsonb not null default '{}',
        created_at timestamptz not null default now()
      )
    `.then(() => undefined).catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  await schemaPromise;
}

export async function recordProviderCostAttempt(input: {
  projectId?: string;
  versionId?: string;
  sceneNumber?: number;
  provider: string;
  model: string;
  operation: string;
  outcome: "succeeded" | "failed";
  costUsd: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}) {
  if (!hasDatabaseUrl()) return;
  try {
    await ensureProviderCostSchema();
    await getSql()`
      insert into provider_cost_events (
        project_id, version_id, scene_number, provider, model, operation,
        outcome, cost_microusd, idempotency_key, metadata_json
      ) values (
        ${input.projectId ?? null}, ${input.versionId ?? null}, ${input.sceneNumber ?? null},
        ${input.provider}, ${input.model}, ${input.operation}, ${input.outcome},
        ${Math.max(0, Math.round(input.costUsd * 1_000_000))}, ${input.idempotencyKey},
        ${JSON.stringify(input.metadata ?? {})}::jsonb
      )
      on conflict (idempotency_key) do nothing
    `;
  } catch (error) {
    console.error("[billing] Provider cost monitoring failed:", error);
  }
}
