import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const profileSource = fs.readFileSync(new URL("../lib/visual-style-profiles.ts", import.meta.url), "utf8");
const profileOutput = ts.transpileModule(profileSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(profileOutput, { module, exports: module.exports, require: () => ({}) });
const { visualStyleDirection, visualStyleProfile, visualStyleProfiles } = module.exports;

const styles = ["电影质感", "极简高级", "明快有活力", "温暖自然"];
const palettes = styles.map((style) => visualStyleProfile(style).palette.join(","));
assert.equal(new Set(palettes).size, styles.length, "every preset should have a distinct palette");
assert.match(visualStyleDirection("电影质感"), /low-key|rim light|35mm|volumetric/i);
assert.match(visualStyleDirection("极简高级"), /minimalist|negative space|softbox|symmetry/i);
assert.match(visualStyleDirection("明快有活力"), /energetic|high-key|accent colors|rhythmic/i);
assert.match(visualStyleDirection("温暖自然"), /warm|window light|human-centered|wood/i);
assert.equal(Object.keys(visualStyleProfiles).length, 4);

const aiVideo = fs.readFileSync(new URL("../lib/ai-video.ts", import.meta.url), "utf8");
const videoBrain = fs.readFileSync(new URL("../lib/video-brain.ts", import.meta.url), "utf8");
assert.match(aiVideo, /visualStyleDirection\(options\.style\)/);
assert.match(aiVideo, /visualBible:[\s\S]*palette: profile\.palette[\s\S]*lighting: profile\.lighting[\s\S]*cameraLanguage: profile\.cameraLanguage/);
assert.match(videoBrain, /visualStyleProfile\(options\.style\)/);
assert.match(videoBrain, /theme: `\$\{profile\.label\} · \$\{profile\.artDirection\}`/);
assert.doesNotMatch(videoBrain, /theme: "统一电影纪实风格"/);

console.log("Visual style profile smoke checks passed.");
