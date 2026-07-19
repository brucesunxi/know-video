import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync(new URL("../app/api/assets/audio/preview/route.ts", import.meta.url), "utf8");
const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(route, /generateAzureChineseSpeech\(profile\.sampleText, undefined, profile\.id\)/);
assert.match(route, /Cache-Control.*private, max-age=3600/s);
assert.doesNotMatch(route, /text:\s*z\.string/);
assert.match(workspace, /\/api\/assets\/audio\/preview/);
assert.match(workspace, /应用到整片/);
assert.match(workspace, /应用到场景/);
assert.match(workspace, /aria-label="配音应用范围"/);
assert.match(workspace, /previewAudioRef\.current\?\.pause\(\)/);
assert.match(styles, /\.kv-voice-options/);
assert.match(styles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);

console.log("Voice preview and switching smoke checks passed.");
