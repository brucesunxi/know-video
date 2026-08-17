import assert from "node:assert/strict";
import fs from "node:fs";

const aiVideo = fs.readFileSync(new URL("../lib/ai-video.ts", import.meta.url), "utf8");
const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");

assert.match(aiVideo, /function getTextModel\(maxTimeoutMs = 90_000\)/);
assert.match(aiVideo, /const generationDeadline = Date\.now\(\) \+ 210_000/);
assert.match(aiVideo, /getTextModel\(42_000\)/);
assert.match(aiVideo, /generationDeadline - 90_000/);
assert.match(aiVideo, /generationDeadline - 50_000/);
assert.match(aiVideo, /Skipping treatment AI repair to preserve the project-generation time budget/);
assert.match(aiVideo, /Skipping storyboard AI repair to preserve durable project persistence/);
assert.match(workspace, /Script and storyboard generation timed out before the project could be saved/);

console.log("Project generation time-budget smoke checks passed.");
