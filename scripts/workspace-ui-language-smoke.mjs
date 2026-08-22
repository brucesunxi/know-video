import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const player = fs.readFileSync(new URL("../app/video-player.tsx", import.meta.url), "utf8");
const voices = fs.readFileSync(new URL("../lib/voice-profiles.ts", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const uiLanguageClient = fs.readFileSync(
  new URL("../lib/ui-language-client.ts", import.meta.url),
  "utf8",
);

assert.match(workspace, /type UiLanguage = "zh-CN" \| "en"/);
assert.match(workspace, /UI_LANGUAGE_STORAGE_KEY/);
assert.match(uiLanguageClient, /UI_LANGUAGE_STORAGE_KEY = "know-video:ui-language"/);
assert.match(workspace, /UiLanguageContext\.Provider/);
assert.match(workspace, /persistUiLanguage\(language\)/);
assert.match(uiLanguageClient, /window\.localStorage\.setItem\(UI_LANGUAGE_STORAGE_KEY, language\)/);
assert.match(uiLanguageClient, /document\.documentElement\.lang = language/);
assert.match(workspace, /className="kv-ui-language-toggle"/);
assert.match(workspace, /切换为英文界面/);
assert.match(workspace, /Switch interface to Chinese/);
assert.match(workspace, /Current interface language: English; switch to Chinese/);
assert.match(workspace, /language === "zh-CN" \? "中文" : "English"/);
assert.match(workspace, /message\.role === "assistant" \? localizedSystemMessage\(message\.content, language\) : message\.content/);
assert.match(workspace, /English narration complete/);
assert.match(workspace, /Narration language does not match generation settings/);
assert.match(workspace, /exportReadinessItems\(project, filmSettings, language\)/);
assert.match(workspace, /language\s*\}\)\}/);
assert.match(workspace, /Controls narration, captions, and on-screen copy only/);
assert.match(workspace, /Continue creating or start a new video/);
assert.match(workspace, /Conversational editing/);
assert.match(workspace, /localizedVoiceCopy\(selectedVoiceProfile, language\)/);
assert.match(workspace, /selectedLanguageOption\.labelEn/);
assert.match(workspace, /const briefTemplatePromptEnglish: Record<string, string>/);
assert.match(workspace, /templatePromptForRole\(template, role, selectedStyle, language\)/);
assert.match(workspace, /localizedGenerationPrompt\(prompt, language\)/);
assert.match(workspace, /"脚本与分镜仍在后台生成，正在自动恢复": "The script and storyboard are still generating\. Recovery is in progress"/);
assert.match(workspace, /const promptExamplesEnglish = \[/);
assert.match(workspace, /uiLanguage=\{language\}/);
assert.match(player, /uiLanguage\?: "zh-CN" \| "en"/);
assert.match(player, /Loading scene visuals and narration/);
assert.match(voices, /labelEn: "Clear energetic male"/);
assert.match(voices, /labelEn: "Grounded brand male"/);
assert.match(voices, /labelEn: "Professional female"/);
assert.doesNotMatch(workspace, /(?:aria-label|title|placeholder)="[^"]*[\u3400-\u9fff][^"]*"/u);
assert.doesNotMatch(player, />\s*[^<{]*[\u3400-\u9fff][^<{]*</u);
assert.match(styles, /\.kv-ui-language-toggle/);

console.log("Workspace UI language smoke checks passed.");
