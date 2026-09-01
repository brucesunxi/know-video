import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync(new URL("../app/api/assets/audio/generate/route.ts", import.meta.url), "utf8");
const audioAssets = fs.readFileSync(new URL("../lib/audio-assets.ts", import.meta.url), "utf8");

assert.match(route, /function audioFailedScenes/);
assert.match(route, /requestedSceneNumbers/);
assert.match(route, /for \(let retry = 0; retry < 2 && failed\.length > 0; retry \+= 1\)/);
assert.match(route, /Retrying failed voice scenes/);
assert.match(route, /generateProjectVoices\(updated, retrySceneNumbers, body\.narrationVoice, \{/);
assert.match(route, /deadlineMs: requestWorkDeadline/);
assert.match(route, /azureMaxAttempts: 1/);
assert.match(route, /persistGeneratedSceneAssets/);
assert.ok(route.indexOf("Retrying failed voice scenes") < route.lastIndexOf("persistGeneratedSceneAssets"));
assert.match(route, /mediaGenerationProgress\(\s*requestedSceneNumbers,/);
assert.match(audioAssets, /generateOpenAISpeech/);
assert.match(audioAssets, /generateAzureSpeech\(/);
assert.match(audioAssets, /options\.allowOpenAIFallback === true/);
assert.match(audioAssets, /ENABLE_OPENAI_TTS_FALLBACK/);
assert.match(audioAssets, /using explicitly enabled OpenAI backup/);
assert.doesNotMatch(route, /allowOpenAIFallback: true/);
assert.doesNotMatch(route, /allowOpenAIFallback: retry >=/);
assert.doesNotMatch(audioAssets, /generateCloudflareSpeech/);

console.log("Audio generation retry smoke checks passed.");
