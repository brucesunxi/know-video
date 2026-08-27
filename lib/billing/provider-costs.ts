import { getSql, hasDatabaseUrl } from "@/lib/db";

export type ProviderCostAttemptInput = {
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
};

export async function recordProviderCostAttempts(inputs: ProviderCostAttemptInput[]) {
  if (!hasDatabaseUrl() || inputs.length === 0) return;
  try {
    const sql = getSql();
    await sql.transaction(inputs.map((input) => sql`
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
      `));
  } catch (error) {
    console.error("[billing] Provider cost monitoring failed:", error);
  }
}

export async function recordProviderCostAttempt(input: ProviderCostAttemptInput) {
  return recordProviderCostAttempts([input]);
}
