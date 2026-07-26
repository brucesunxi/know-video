import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync(new URL("../app/api/assets/generate/route.ts", import.meta.url), "utf8");

assert.match(route, /function imageFailedScenes/);
assert.match(route, /requestedSceneNumbers/);
assert.match(route, /for \(let retry = 0; retry < 2 && failedTargets\.length > 0; retry \+= 1\)/);
assert.match(route, /Retrying failed image scenes/);
assert.match(route, /generateProjectSceneImages\(updated, \{/);
assert.match(route, /sceneNumbers: retrySceneNumbers/);
assert.match(route, /persistGeneratedSceneAssets/);
assert.ok(route.indexOf("Retrying failed image scenes") < route.lastIndexOf("persistGeneratedSceneAssets"));
assert.match(route, /mediaGenerationProgress\(\s*requestedSceneNumbers,/);

console.log("Image generation retry smoke checks passed.");
