import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(workspace, /方案待确认，当前视频还没有被改动/);
assert.match(workspace, /继续输入会先调整这个方案/);
assert.match(workspace, /planScopeLabel\(pendingPlan, scenes\.length\)/);
assert.match(workspace, /planAssetWorkLabel\(pendingPlan\)/);
assert.match(workspace, /function planApplyLabel/);
assert.match(workspace, /function planReviewChecklist/);
assert.match(workspace, /aria-label="执行前检查"/);
assert.match(workspace, /className=\{item\.tone\}/);
assert.match(workspace, /\{applyLabel\}/);
assert.match(workspace, /点击应用才会真正改片/);
assert.match(workspace, /className="kv-chat-draft-actions"/);
assert.match(workspace, /<button className="kv-primary" disabled=\{isBusy\} onClick=\{onApply\} type="button">/);
assert.match(workspace, /<button disabled=\{isBusy\} onClick=\{onCancel\} type="button">取消方案<\/button>/);

assert.match(styles, /\.kv-plan-state/);
assert.match(styles, /\.kv-plan-state-grid/);
assert.match(styles, /\.kv-plan-checklist/);
assert.match(styles, /\.kv-plan-checklist span\.attention svg/);
assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.kv-plan-checklist/);
assert.match(styles, /\.kv-chat-draft-note/);
assert.match(styles, /\.kv-chat-draft-actions/);
assert.match(styles, /\.kv-chat-draft-actions \.kv-primary/);

console.log("Workspace review-state smoke checks passed.");
