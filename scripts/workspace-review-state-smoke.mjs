import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(workspace, /方案待确认，当前视频还没有被改动/);
assert.match(workspace, /继续输入会先调整这个方案/);
assert.match(workspace, /planScopeLabel\(pendingPlan, scenes\.length\)/);
assert.match(workspace, /planAssetWorkLabel\(pendingPlan\)/);
assert.match(workspace, /要真正改片，请点击“应用修改”/);
assert.match(workspace, /要改方案，继续输入补充要求/);

assert.match(styles, /\.kv-plan-state/);
assert.match(styles, /\.kv-plan-state-grid/);
assert.match(styles, /\.kv-chat-draft-note/);

console.log("Workspace review-state smoke checks passed.");
