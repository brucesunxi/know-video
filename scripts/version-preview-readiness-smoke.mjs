import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(workspace, /function versionMediaSummary/);
assert.match(workspace, /function versionOutputLabel/);
assert.match(workspace, /function versionOutputLabel[\s\S]*if \(version\.renderUrl\) return "已有 MP4 成片";[\s\S]*if \(version\.status === "rendering" \|\| version\.renderJobId\) return "成片合成中";/);
assert.match(workspace, /const selectedSummary = versionMediaSummary\(preview\.version\)/);
assert.match(workspace, /const currentSummary = versionMediaSummary\(preview\.currentVersion\)/);
assert.match(workspace, /mediaCompletenessLabel\(selectedSummary\)/);
assert.match(workspace, /mediaCompletenessLabel\(currentSummary\)/);
assert.match(workspace, /versionOutputLabel\(preview\.version\)/);
assert.match(workspace, /versionOutputLabel\(preview\.currentVersion\)/);
assert.match(workspace, /已有 MP4 成片/);
assert.match(workspace, /恢复后需补齐素材/);

assert.match(styles, /\.kv-version-comparison-summary small\.complete/);
assert.match(styles, /\.kv-version-comparison-summary small\.partial/);

console.log("Version preview readiness smoke checks passed.");
