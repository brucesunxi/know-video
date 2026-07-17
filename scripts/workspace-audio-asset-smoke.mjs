import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(workspace, /function audioAssetQualityItems/);
assert.match(workspace, /function assetUsageItems/);
assert.match(workspace, /function assetStateBadge/);
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
assert.match(workspace, /当前画面/);
assert.match(workspace, /当前动态/);
assert.match(workspace, /当前配音/);
assert.match(workspace, /候选未采用/);
assert.match(workspace, /预览和 MP4 导出会使用这张画面/);
assert.match(workspace, /对比或采用前不会影响当前视频/);
assert.match(workspace, /className=\{`kv-asset-state \$\{stateBadge\.tone\}`\}/);
assert.match(workspace, /aria-label="素材采用状态"/);
assert.match(workspace, /aria-label="素材用途"/);
assert.match(workspace, /className="kv-asset-usage"/);
assert.match(workspace, /usageItems\.map/);
assert.match(workspace, /aria-label="配音质量信息"/);
assert.match(workspace, /className="kv-asset-audio-quality"/);
assert.match(workspace, /audioQualityItems\.map/);

assert.match(styles, /\.kv-asset-usage/);
assert.match(styles, /\.kv-asset-usage small/);
assert.match(styles, /\.kv-asset-state/);
assert.match(styles, /\.kv-asset-state\.active/);
assert.match(styles, /\.kv-asset-state\.candidate/);
assert.match(styles, /\.kv-asset-state em/);
assert.match(styles, /\.kv-asset-audio-quality/);
assert.match(styles, /\.kv-asset-audio-quality small/);
assert.match(styles, /background: #f1fbf8/);

console.log("Workspace audio asset smoke checks passed.");
