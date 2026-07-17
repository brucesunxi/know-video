import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(workspace, /className="kv-mobile-chat-action"/);
assert.match(workspace, /document\.getElementById\("kv-chat-panel"\)\?\.scrollIntoView/);
assert.match(workspace, /className="kv-enhance-action"/);
assert.match(workspace, /className="kv-video-action"/);
assert.match(workspace, /className="kv-primary"[\s\S]*exportActionLabel/);

assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.kv-actionbar\s*\{[\s\S]*position: sticky;[\s\S]*backdrop-filter: blur\(16px\);/);
assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.kv-actions\s*\{[\s\S]*display: grid;[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.kv-actions \.kv-primary\s*\{[\s\S]*grid-column: 1 \/ -1;/);
assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.kv-actions \.kv-cancel-export\s*\{[\s\S]*grid-column: 1 \/ -1;/);
assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.kv-tool-menu-wrap > button\s*\{[\s\S]*width: 100%;[\s\S]*justify-content: center;/);
assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.kv-tabs\s*\{[\s\S]*display: grid;[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);

console.log("Workspace mobile layout smoke checks passed.");
