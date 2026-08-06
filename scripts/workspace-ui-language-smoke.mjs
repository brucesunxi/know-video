import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(workspace, /type UiLanguage = "zh-CN" \| "en"/);
assert.match(workspace, /UI_LANGUAGE_STORAGE_KEY = "know-video:ui-language"/);
assert.match(workspace, /UiLanguageContext\.Provider/);
assert.match(workspace, /window\.localStorage\.setItem\(UI_LANGUAGE_STORAGE_KEY, language\)/);
assert.match(workspace, /document\.documentElement\.lang = language/);
assert.match(workspace, /className="kv-ui-language-toggle"/);
assert.match(workspace, /切换为英文界面/);
assert.match(workspace, /Switch interface to Chinese/);
assert.match(workspace, /Controls narration, captions, and on-screen copy only/);
assert.match(workspace, /Continue creating or start a new video/);
assert.match(workspace, /Conversational editing/);
assert.match(styles, /\.kv-ui-language-toggle/);

console.log("Workspace UI language smoke checks passed.");
