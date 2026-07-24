import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync(new URL("../app/api/edit-plan/route.ts", import.meta.url), "utf8");
const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const planner = fs.readFileSync(new URL("../lib/ai-video.ts", import.meta.url), "utf8");

assert.doesNotMatch(route, /candidateEditFromRequest/);
assert.doesNotMatch(workspace, /candidateEditFromRequest/);
assert.match(route, /selectedSceneNumber:\s*body\.selectedSceneNumber/);
assert.match(route, /if \(result\.directAction\)/);
assert.match(route, /result\.directAction\.kind === "restore-parent-version"/);
assert.match(route, /restoreProjectVersion\(\{/);
assert.match(workspace, /data\.action === "version-restored"/);
assert.match(planner, /Currently selected scene number/);
assert.match(planner, /return directAction visual-candidate/);
assert.match(planner, /return directAction restore-parent-version/);

console.log("Conversation edit route smoke checks passed.");
