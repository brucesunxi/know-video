import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(workspace, /function audioAssetQualityItems/);
assert.match(workspace, /asset\.type !== "audio"/);
assert.match(workspace, /actualDurationSeconds/);
assert.match(workspace, /targetDurationSeconds/);
assert.match(workspace, /narrationVoiceProfile\(asset\.metadata\.narrationVoice as NarrationVoice\)\.label/);
assert.match(workspace, /aria-label="配音质量信息"/);
assert.match(workspace, /className="kv-asset-audio-quality"/);
assert.match(workspace, /audioQualityItems\.map/);

assert.match(styles, /\.kv-asset-audio-quality/);
assert.match(styles, /\.kv-asset-audio-quality small/);
assert.match(styles, /background: #f1fbf8/);

console.log("Workspace audio asset smoke checks passed.");
