import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(workspace, /function sceneNumberListLabel/);
assert.match(workspace, /aria-label="成片素材检查"/);
assert.match(workspace, /成片素材还没有补齐/);
assert.match(workspace, /补齐画面：场景 \{sceneNumberListLabel\(missingSceneNumbers\)\}/);
assert.match(workspace, /补齐配音：场景 \{sceneNumberListLabel\(missingAudioSceneNumbers\)\}/);
assert.doesNotMatch(workspace, /kv-media-warning/);

assert.match(styles, /\.kv-media-readiness/);
assert.match(styles, /\.kv-media-readiness-actions/);
assert.doesNotMatch(styles, /\.kv-media-warning/);

console.log("Workspace media readiness smoke checks passed.");
