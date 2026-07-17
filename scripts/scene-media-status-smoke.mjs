import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(workspace, /function sceneMediaState/);
assert.match(workspace, /function sceneMediaStatusLabel/);
assert.match(workspace, /sceneHasVisualAsset/);
assert.match(workspace, /sceneHasAudioAsset/);
assert.match(workspace, /className=\{`kv-scene-media-status \$\{mediaState\.ready \? "ready" : "partial"\}`\}/);
assert.match(workspace, /生成本场景画面/);
assert.match(workspace, /生成本场景配音/);
assert.match(workspace, /生成动态镜头/);
assert.match(workspace, /onRegenerate=\{onRegenerate\}/);
assert.match(workspace, /onRegenerateAudio=\{onRegenerateAudio\}/);
assert.match(workspace, /onGenerateClip=\{onGenerateClip\}/);

assert.match(styles, /\.kv-scene-readiness-card/);
assert.match(styles, /\.kv-scene-strip button\.needs-media/);
assert.match(styles, /\.kv-scene-media-status\.ready/);
assert.match(styles, /\.kv-scene-media-status\.partial/);

console.log("Scene media status smoke checks passed.");
