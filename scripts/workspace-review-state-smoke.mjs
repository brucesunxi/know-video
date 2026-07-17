import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(workspace, /方案待确认，当前视频还没有被改动/);
assert.match(workspace, /继续输入会先调整这个方案/);
assert.match(workspace, /planScopeLabel\(pendingPlan, scenes\.length\)/);
assert.match(workspace, /planAssetWorkLabel\(pendingPlan\)/);
assert.match(workspace, /function planApplyLabel/);
assert.match(workspace, /function planRenderImpactLabel/);
assert.match(workspace, /function planReviewChecklist/);
assert.match(workspace, /function planRequestTrail/);
assert.match(workspace, /\.split\(\/\\n补充要求：\/g\)/);
assert.match(workspace, /aria-label="执行前检查"/);
assert.match(workspace, /成片影响/);
assert.match(workspace, /应用后需重新导出 MP4/);
assert.match(workspace, /现有成片不受影响/);
assert.match(workspace, /aria-label="方案对话脉络"/);
assert.match(workspace, /<span>原始需求<\/span>/);
assert.match(workspace, /补充要求 \{index \+ 1\}/);
assert.match(workspace, /className=\{item\.tone\}/);
assert.match(workspace, /\{applyLabel\}/);
assert.match(workspace, /点击应用才会真正改片/);
assert.match(workspace, /className="kv-chat-draft-actions"/);
assert.match(workspace, /<button className="kv-primary" disabled=\{isBusy\} onClick=\{onApply\} type="button">/);
assert.match(workspace, /<button disabled=\{isBusy\} onClick=\{onCancel\} type="button">取消方案<\/button>/);

assert.match(styles, /\.kv-plan-state/);
assert.match(styles, /\.kv-plan-state-grid/);
assert.match(styles, /\.kv-plan-request-trail/);
assert.match(styles, /\.kv-plan-request-trail li:first-child/);
assert.match(styles, /\.kv-plan-request-trail p/);
assert.match(styles, /\.kv-plan-checklist/);
assert.match(styles, /grid-template-columns: repeat\(auto-fit, minmax\(132px, 1fr\)\)/);
assert.match(styles, /\.kv-plan-checklist span\.attention svg/);
assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.kv-plan-checklist/);
assert.match(styles, /\.kv-chat-draft-note/);
assert.match(styles, /\.kv-chat-draft-actions/);
assert.match(styles, /\.kv-chat-draft-actions \.kv-primary/);

console.log("Workspace review-state smoke checks passed.");
