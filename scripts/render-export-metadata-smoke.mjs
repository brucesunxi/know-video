import assert from "node:assert/strict";
import fs from "node:fs";

const types = fs.readFileSync(new URL("../lib/types.ts", import.meta.url), "utf8");
const renderJobs = fs.readFileSync(new URL("../lib/render-jobs.ts", import.meta.url), "utf8");
const callback = fs.readFileSync(new URL("../app/api/render-jobs/callback/route.ts", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../worker/render-once.mjs", import.meta.url), "utf8");
const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

assert.match(types, /metadata\?: Record<string, unknown>/);
assert.match(schema, /metadata_json jsonb not null default '\{\}'/);
assert.match(renderJobs, /metadata_json: unknown/);
assert.match(renderJobs, /metadata: row\.metadata_json/);
assert.match(renderJobs, /metadata\?: Record<string, unknown>/);
assert.match(renderJobs, /async function ensureRenderJobMetadataColumn/);
assert.match(renderJobs, /alter table render_jobs add column if not exists metadata_json/);
assert.doesNotMatch(callback, /Ready callback requires output metadata/);
assert.match(callback, /quality: z\.literal\("passed"\)/);
assert.match(worker, /const outputMetadata = await inspectRenderedOutput/);
assert.match(worker, /metadata: \{\s*quality: "passed"/);
assert.match(workspace, /function renderJobQualityLabel/);
assert.match(workspace, /function renderJobMetadataItems/);
assert.match(workspace, /aria-label="成片校验信息"/);
assert.match(styles, /\.kv-export-quality/);
assert.match(styles, /\.kv-export-metadata/);

console.log("Render export metadata smoke checks passed.");
