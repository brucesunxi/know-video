import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(workspace, /function audioAssetQualityItems/);
assert.match(workspace, /function assetUsageItems/);
assert.match(workspace, /asset\.type !== "audio"/);
assert.match(workspace, /actualDurationSeconds/);
assert.match(workspace, /targetDurationSeconds/);
assert.match(workspace, /时长匹配/);
assert.match(workspace, /旁白偏长/);
assert.match(workspace, /旁白偏短/);
assert.match(workspace, /actualSeconds > targetSeconds \* 1\.03/);
assert.match(workspace, /actualSeconds < targetSeconds \* 0\.55/);
assert.match(workspace, /narrationVoiceProfile\(asset\.metadata\.narrationVoice as NarrationVoice\)\.label/);
assert.match(workspace, /用于预览和 MP4 导出/);
assert.match(workspace, /动态镜头优先播放/);
assert.match(workspace, /进入旁白音轨/);
assert.match(workspace, /不影响当前视频/);
assert.match(workspace, /aria-label="素材用途"/);
assert.match(workspace, /className="kv-asset-usage"/);
assert.match(workspace, /usageItems\.map/);
assert.match(workspace, /aria-label="配音质量信息"/);
assert.match(workspace, /className="kv-asset-audio-quality"/);
assert.match(workspace, /audioQualityItems\.map/);

assert.match(styles, /\.kv-asset-usage/);
assert.match(styles, /\.kv-asset-usage small/);
assert.match(styles, /\.kv-asset-audio-quality/);
assert.match(styles, /\.kv-asset-audio-quality small/);
assert.match(styles, /background: #f1fbf8/);

console.log("Workspace audio asset smoke checks passed.");
