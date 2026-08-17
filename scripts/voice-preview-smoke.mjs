import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync(new URL("../app/api/assets/audio/preview/route.ts", import.meta.url), "utf8");
const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const azureSpeech = fs.readFileSync(new URL("../lib/azure-speech.ts", import.meta.url), "utf8");

assert.match(route, /language: z\.enum\(\["中文", "英文"\]\)/);
assert.match(route, /generateAzureSpeech\(/);
assert.match(route, /english \? profile\.sampleTextEn : profile\.sampleText/);
assert.match(azureSpeech, /xml:lang="\$\{input\.language\}"/);
assert.match(azureSpeech, /profile\.azureVoiceZh : profile\.azureVoiceEn/);
assert.match(azureSpeech, /AZURE_SPEECH_ENGLISH_VOICE/);
assert.match(route, /Cache-Control.*private, max-age=3600/s);
assert.doesNotMatch(route, /text:\s*z\.string/);
assert.match(workspace, /\/api\/assets\/audio\/preview/);
assert.match(workspace, /JSON\.stringify\(\{ voice, language: options\.language \}\)/);
assert.match(workspace, /JSON\.stringify\(\{ voice, language: previewNarrationLanguage \}\)/);
assert.match(workspace, /应用到整片/);
assert.match(workspace, /应用到场景/);
assert.match(workspace, /aria-label=\{text\("配音应用范围", "Narration scope"\)\}/);
assert.match(workspace, /previewAudioRef\.current\?\.pause\(\)/);
assert.match(styles, /\.kv-voice-options/);
assert.match(styles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
assert.match(styles, /\.kv-voice-library/);
assert.match(workspace, /text\("男声", "Male voices"\)/);
assert.match(workspace, /text\("女声", "Female voices"\)/);

console.log("Voice preview and switching smoke checks passed.");
