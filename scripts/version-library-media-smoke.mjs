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
assert.match(workspace, /<small className=\{mediaCompletenessClass\(version\)\}>\{mediaCompletenessLabel\(version\)\}<\/small>/);
assert.match(styles, /\.kv-version-list small\.complete/);
assert.match(styles, /\.kv-version-list small\.partial/);

console.log("Version library media smoke checks passed.");
