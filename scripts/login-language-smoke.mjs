import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const home = read("app/page.tsx");
const login = read("app/login-screen.tsx");
const publicSwitch = read("app/public-language-switch.tsx");
const workspace = read("app/workspace-client.tsx");
const persistence = read("lib/ui-language-client.ts");

assert.match(home, /getPublicLanguage/);
assert.match(home, /initialLanguage=\{language\}/);
assert.match(login, /initialLanguage: PublicLanguage/);
assert.match(login, /useState<LoginLanguage>\(initialLanguage\)/);
assert.match(login, /persistUiLanguage\(initialLanguage\)/);
assert.match(login, /persistUiLanguage\(next\)/);
assert.doesNotMatch(login, /useState<LoginLanguage>\("zh-CN"\)/);
assert.match(publicSwitch, /persistUiLanguage\(nextLanguage\)/);
assert.match(workspace, /persistUiLanguage\(language\)/);
assert.match(persistence, /window\.localStorage\.setItem\(UI_LANGUAGE_STORAGE_KEY, language\)/);
assert.match(persistence, /PUBLIC_LANGUAGE_COOKIE/);
assert.match(persistence, /document\.documentElement\.lang = language/);

console.log("Login language synchronization smoke checks passed.");
