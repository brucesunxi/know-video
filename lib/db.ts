import { neon } from "@neondatabase/serverless";
import type { NeonQueryFunction } from "@neondatabase/serverless";

let sqlClient: NeonQueryFunction<false, false> | undefined;
let sqlClientDatabaseUrl: string | undefined;

export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL);
}

export function getSql() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!sqlClient || sqlClientDatabaseUrl !== databaseUrl) {
    sqlClient = neon(databaseUrl);
    sqlClientDatabaseUrl = databaseUrl;
  }

  return sqlClient;
}
