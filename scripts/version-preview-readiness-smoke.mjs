import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(workspace, /function versionMediaSummary/);
assert.match(workspace, /function versionOutputLabel/);
assert.match(workspace, /function outputReadiness/);
assert.match(workspace, /function versionOutputLabel[\s\S]*outputReadiness\(\{ \.\.\.summary, status: version\.status, renderUrl: version\.renderUrl, renderJobId: version\.renderJobId \}\)\.label/);
assert.match(workspace, /const selectedSummary = versionMediaSummary\(preview\.version\)/);
assert.match(workspace, /const currentSummary = versionMediaSummary\(preview\.currentVersion\)/);
assert.match(workspace, /mediaCompletenessLabel\(selectedSummary\)/);
assert.match(workspace, /mediaCompletenessLabel\(currentSummary\)/);
assert.match(workspace, /versionOutputLabel\(preview\.version\)/);
assert.match(workspace, /versionOutputLabel\(preview\.currentVersion\)/);
assert.match(workspace, /MP4 已就绪/);
assert.match(workspace, /需补齐素材/);

assert.match(styles, /\.kv-version-comparison-summary small\.complete/);
assert.match(styles, /\.kv-version-comparison-summary small\.partial/);

console.log("Version preview readiness smoke checks passed.");
