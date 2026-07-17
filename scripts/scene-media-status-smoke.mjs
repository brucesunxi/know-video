import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(workspace, /function sceneMediaState/);
assert.match(workspace, /function sceneMediaStatusLabel/);
assert.match(workspace, /function sceneMediaDiagnosticItems/);
assert.match(workspace, /sceneHasVisualAsset/);
assert.match(workspace, /sceneHasAudioAsset/);
assert.match(workspace, /className=\{`kv-scene-media-status \$\{mediaState\.ready \? "ready" : "partial"\}`\}/);
assert.match(workspace, /aria-label="本场景素材诊断"/);
assert.match(workspace, /className="kv-scene-asset-dots"/);
assert.match(workspace, /aria-label=\{`场景 \$\{scene\.sceneNumber\} 素材状态`\}/);
assert.match(workspace, /sceneMediaDiagnosticItems\(scene\)\.map/);
assert.match(workspace, /title=\{`\$\{item\.label\}：\$\{item\.detail\}`\}/);
assert.match(workspace, /缺少图片或视频片段/);
assert.match(workspace, /导出会静音或缺旁白/);
assert.match(workspace, /可基于画面生成/);
assert.match(workspace, /生成本场景画面/);
assert.match(workspace, /生成本场景配音/);
assert.match(workspace, /生成动态镜头/);
assert.match(workspace, /onRegenerate=\{onRegenerate\}/);
assert.match(workspace, /onRegenerateAudio=\{onRegenerateAudio\}/);
assert.match(workspace, /onGenerateClip=\{onGenerateClip\}/);

assert.match(styles, /\.kv-scene-readiness-card/);
assert.match(styles, /\.kv-scene-media-diagnostics/);
assert.match(styles, /\.kv-scene-media-diagnostics span\.ready/);
assert.match(styles, /\.kv-scene-media-diagnostics span\.optional/);
assert.match(styles, /\.kv-scene-media-diagnostics span\.missing/);
assert.match(styles, /\.kv-scene-media-diagnostics span\.blocked/);
assert.match(styles, /\.kv-scene-strip button\.needs-media/);
assert.match(styles, /\.kv-scene-media-status\.ready/);
assert.match(styles, /\.kv-scene-media-status\.partial/);
assert.match(styles, /\.kv-scene-asset-dots/);
assert.match(styles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
assert.match(styles, /\.kv-scene-asset-dots i\.ready/);
assert.match(styles, /\.kv-scene-asset-dots i\.optional/);
assert.match(styles, /\.kv-scene-asset-dots i\.missing/);

console.log("Scene media status smoke checks passed.");
