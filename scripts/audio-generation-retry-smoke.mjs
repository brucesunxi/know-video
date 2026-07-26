import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync(new URL("../app/api/assets/audio/generate/route.ts", import.meta.url), "utf8");

assert.match(route, /function audioFailedScenes/);
assert.match(route, /requestedSceneNumbers/);
assert.match(route, /for \(let retry = 0; retry < 2 && failed\.length > 0; retry \+= 1\)/);
assert.match(route, /Retrying failed voice scenes/);
assert.match(route, /generateProjectVoices\(updated, retrySceneNumbers, body\.narrationVoice\)/);
assert.match(route, /persistGeneratedSceneAssets/);
assert.ok(route.indexOf("Retrying failed voice scenes") < route.lastIndexOf("persistGeneratedSceneAssets"));
assert.match(route, /mediaGenerationProgress\(\s*requestedSceneNumbers,/);

console.log("Audio generation retry smoke checks passed.");
