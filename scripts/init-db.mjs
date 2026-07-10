import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required. Add it to .env.local or your Vercel environment.");
  process.exit(1);
}

const schema = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
const sql = neon(databaseUrl);

const statements = schema
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

for (const statement of statements) {
  await sql(statement);
}

console.log("Database schema applied.");
