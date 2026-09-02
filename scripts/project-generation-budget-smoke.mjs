import assert from "node:assert/strict";
import fs from "node:fs";

const aiVideo = fs.readFileSync(new URL("../lib/ai-video.ts", import.meta.url), "utf8");
const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const projects = fs.readFileSync(new URL("../app/api/projects/route.ts", import.meta.url), "utf8");

assert.match(aiVideo, /function getTextModel\(maxTimeoutMs = 90_000\)/);
assert.match(aiVideo, /planningBudget\?: \{/);
assert.match(aiVideo, /planningBudget\?\.deadlineMs \?\? 210_000/);
assert.match(aiVideo, /planningBudget\?\.textTimeoutMs \?\? 42_000/);
assert.match(aiVideo, /generationDeadline - 90_000/);
assert.match(aiVideo, /generationDeadline - 50_000/);
assert.match(aiVideo, /Treatment time budget exhausted with required narration constraints/);
assert.match(aiVideo, /Skipping storyboard AI repair to preserve durable project persistence/);
assert.match(workspace, /Script and storyboard generation timed out before the project could be saved/);
assert.match(projects, /BACKGROUND_STORYBOARD_BUDGET_MS = 135_000/);
assert.match(projects, /BACKGROUND_STORYBOARD_TEXT_TIMEOUT_MS = 24_000/);
assert.match(projects, /Storyboard planning exceeded/);
assert.match(projects, /generateProjectFromPrompt\(body\.prompt, undefined, body\.options\)/);
assert.match(projects, /Initial media queue handoff failed[\s\S]*watchdog recovery remains active/);
assert.match(projects, /await attachGenerationRequestProject[\s\S]*try \{[\s\S]*await enqueueProjectMediaScene/);

console.log("Project generation time-budget smoke checks passed.");
