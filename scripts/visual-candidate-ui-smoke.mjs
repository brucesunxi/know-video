import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(workspace, /function VisualCandidateComparison/);
assert.match(workspace, /const hasClip = scene\.assets\.some\(\(asset\) => asset\.type === "clip" && asset\.url\)/);
assert.match(workspace, /const impactItems = \[/);
assert.match(workspace, /创建可恢复的新版本/);
assert.match(workspace, /替换当前场景画面/);
assert.match(workspace, /移除本场景动态镜头/);
assert.match(workspace, /需要重新导出 MP4/);
assert.match(workspace, /aria-label="采用候选后的影响"/);
assert.match(workspace, /className="kv-visual-adopt-impact"/);
assert.match(workspace, /className="kv-visual-compare-actions"/);

assert.match(styles, /\.kv-visual-adopt-impact/);
assert.match(styles, /\.kv-visual-adopt-impact span/);
assert.match(styles, /\.kv-visual-compare-actions/);

console.log("Visual candidate UI smoke checks passed.");
