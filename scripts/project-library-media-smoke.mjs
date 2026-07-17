import assert from "node:assert/strict";
import fs from "node:fs";

const types = fs.readFileSync(new URL("../lib/types.ts", import.meta.url), "utf8");
const store = fs.readFileSync(new URL("../lib/project-store.ts", import.meta.url), "utf8");
const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(types, /visualCount: number/);
assert.match(types, /audioCount: number/);
assert.match(types, /renderUrl\?: string/);
assert.match(store, /pv\.render_url/);
assert.match(store, /visualCount: row\.visual_count/);
assert.match(store, /audioCount: row\.audio_count/);
assert.match(store, /renderUrl: row\.render_url \?\? undefined/);
assert.match(store, /visualCount: demoProject\.currentVersion\.scenes\.filter/);
assert.match(workspace, /function mediaCompletenessLabel/);
assert.match(workspace, /function mediaCompletenessClass/);
assert.match(workspace, /function outputReadiness/);
assert.match(workspace, /画面 \$\{item\.visualCount\}\/\$\{item\.sceneCount\} · 配音 \$\{item\.audioCount\}\/\$\{item\.sceneCount\}/);
assert.match(workspace, /className=\{mediaCompletenessClass\(item\)\}/);
assert.match(workspace, /className=\{`kv-output-status \$\{outputReadiness\(item\)\.tone\}`\}/);
assert.match(workspace, /outputReadiness\(item\)\.label/);
assert.match(styles, /\.kv-project-card-body small\.complete/);
assert.match(styles, /\.kv-project-card-body small\.partial/);
assert.match(styles, /\.kv-project-card-body small\.kv-output-status\.ready/);
assert.match(styles, /\.kv-project-card-body small\.kv-output-status\.working/);
assert.match(styles, /\.kv-project-card-body small\.kv-output-status\.attention/);

console.log("Project library media smoke checks passed.");
