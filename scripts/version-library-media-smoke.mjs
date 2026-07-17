import assert from "node:assert/strict";
import fs from "node:fs";

const types = fs.readFileSync(new URL("../lib/types.ts", import.meta.url), "utf8");
const mutations = fs.readFileSync(new URL("../lib/project-mutations.ts", import.meta.url), "utf8");
const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(types, /ProjectVersionSummary[\s\S]*visualCount: number/);
assert.match(types, /ProjectVersionSummary[\s\S]*audioCount: number/);
assert.match(mutations, /visualCount: row\.visual_count/);
assert.match(mutations, /audioCount: row\.audio_count/);
assert.match(mutations, /visualCount: demoProject\.currentVersion\.scenes\.filter/);
assert.match(workspace, /function mediaCompletenessLabel/);
assert.match(workspace, /function mediaCompletenessClass/);
assert.match(workspace, /function outputReadiness/);
assert.match(workspace, /function versionActionInsight/);
assert.match(workspace, /<small className=\{mediaCompletenessClass\(version\)\}>\{mediaCompletenessLabel\(version\)\}<\/small>/);
assert.match(workspace, /className=\{`kv-output-status \$\{outputReadiness\(version\)\.tone\}`\}/);
assert.match(workspace, /outputReadiness\(version\)\.label/);
assert.match(workspace, /className="kv-version-action-insight"/);
assert.match(workspace, /恢复后需要先补齐素材/);
assert.match(workspace, /当前版本素材齐全，可直接导出 MP4/);
assert.match(styles, /\.kv-version-list small\.complete/);
assert.match(styles, /\.kv-version-list small\.partial/);
assert.match(styles, /\.kv-version-list \.kv-version-action-insight/);
assert.match(styles, /\.kv-version-list article\.current \.kv-version-action-insight/);
assert.match(styles, /\.kv-version-list small\.kv-output-status\.ready/);
assert.match(styles, /\.kv-version-list small\.kv-output-status\.working/);
assert.match(styles, /\.kv-version-list small\.kv-output-status\.attention/);

console.log("Version library media smoke checks passed.");
