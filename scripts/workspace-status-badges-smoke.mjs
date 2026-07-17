import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(workspace, /function projectStatusBadges/);
assert.match(workspace, /version\.assetStatus === "ready"/);
assert.match(workspace, /version\.status === "rendering" \|\| version\.renderJobId/);
assert.match(workspace, /version\.renderUrl/);
assert.match(workspace, /const output = version\.renderUrl[\s\S]*version\.status === "rendering" \|\| version\.renderJobId/);
assert.match(workspace, /renderJobId: undefined, renderUrl: completed\.renderUrl, status: "ready"/);
assert.match(workspace, /statusBadges\.map/);
assert.doesNotMatch(workspace, /<span>智能分镜<\/span>/);
assert.doesNotMatch(workspace, /<span>云端素材<\/span>/);

assert.match(styles, /\.kv-status-row span\.working/);
assert.match(styles, /\.kv-status-row span\.attention/);
assert.match(styles, /\.kv-status-row span\.neutral/);
assert.match(styles, /\.kv-status-row span:nth-child\(n \+ 4\)/);

console.log("Workspace status badges smoke checks passed.");
