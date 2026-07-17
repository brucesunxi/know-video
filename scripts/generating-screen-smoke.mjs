import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(workspace, /function elapsedGenerationLabel/);
assert.match(workspace, /startedAt\?: number/);
assert.match(workspace, /setGenerationStartedAt\(pending\.startedAt\)/);
assert.match(workspace, /const startedAt = Date\.now\(\)/);
assert.match(workspace, /startedAt=\{generationStartedAt\}/);
assert.match(workspace, /className="kv-generation-status-strip"/);
assert.match(workspace, /刷新后继续找回任务/);
assert.match(workspace, /\{Math\.min\(activeIndex \+ 1, steps\.length\)\} \/ \{steps\.length\}/);

assert.match(styles, /\.kv-generation-status-strip/);
assert.match(styles, /@media \(max-width: 1040px\)[\s\S]*\.kv-generation-status-strip/);

console.log("Generating screen smoke checks passed.");
