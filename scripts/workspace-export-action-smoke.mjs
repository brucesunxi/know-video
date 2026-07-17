import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");

assert.match(workspace, /function exportActionLabel/);
assert.match(workspace, /invalidMediaCount\?: number/);
assert.match(workspace, /先修复 \$\{input\.invalidMediaCount\} 个异常素材/);
assert.match(workspace, /missingVisualCount > 0 && input\.missingAudioCount > 0/);
assert.match(workspace, /缺 \$\{input\.missingVisualCount\} 个画面 · \$\{input\.missingAudioCount\} 段配音/);
assert.match(workspace, /缺 \$\{input\.missingVisualCount\} 个画面/);
assert.match(workspace, /缺 \$\{input\.missingAudioCount\} 段配音/);
assert.match(workspace, /exportActionLabel\(\{\s*exportProgress,\s*renderUrl: project\.currentVersion\.renderUrl,\s*missingVisualCount: missingSceneNumbers\.length,\s*missingAudioCount: missingAudioSceneNumbers\.length,\s*invalidMediaCount: invalidRenderMedia\.length/s);
assert.match(workspace, /invalidRenderMedia\.length > 0/);
assert.doesNotMatch(workspace, /\? "下载 MP4"\s*:\s*"导出 MP4"\}/);

console.log("Workspace export action smoke checks passed.");
