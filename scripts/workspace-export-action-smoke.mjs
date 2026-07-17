import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(workspace, /function exportActionLabel/);
assert.match(workspace, /function renderJobRecoveryAdvice/);
assert.match(workspace, /建议先重做提示中的异常画面或配音/);
assert.match(workspace, /建议稍等片刻后重新导出/);
assert.match(workspace, /invalidMediaCount\?: number/);
assert.match(workspace, /先修复 \$\{input\.invalidMediaCount\} 个异常素材/);
assert.match(workspace, /missingVisualCount > 0 && input\.missingAudioCount > 0/);
assert.match(workspace, /缺 \$\{input\.missingVisualCount\} 个画面 · \$\{input\.missingAudioCount\} 段配音/);
assert.match(workspace, /缺 \$\{input\.missingVisualCount\} 个画面/);
assert.match(workspace, /缺 \$\{input\.missingAudioCount\} 段配音/);
assert.match(workspace, /exportActionLabel\(\{\s*exportProgress,\s*renderUrl: project\.currentVersion\.renderUrl,\s*missingVisualCount: missingSceneNumbers\.length,\s*missingAudioCount: missingAudioSceneNumbers\.length,\s*invalidMediaCount: invalidRenderMedia\.length/s);
assert.match(workspace, /invalidRenderMedia\.length > 0/);
assert.match(workspace, /const recoveryAdvice = renderJobRecoveryAdvice\(job\)/);
assert.match(workspace, /role="note"[\s\S]*\{recoveryAdvice\}/);
assert.match(workspace, /className="kv-export-retry"[\s\S]*重新导出 MP4/);
assert.doesNotMatch(workspace, /\? "下载 MP4"\s*:\s*"导出 MP4"\}/);
assert.match(styles, /\.kv-export-recovery/);
assert.match(styles, /button\.kv-export-retry/);

console.log("Workspace export action smoke checks passed.");
