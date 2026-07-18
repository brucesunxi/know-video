import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const speechTiming = fs.readFileSync(new URL("../lib/speech-timing.ts", import.meta.url), "utf8")
  .replace(/^export /gm, "");
const source = fs.readFileSync(new URL("../lib/narration-fit.ts", import.meta.url), "utf8")
  .replace(/^import .*$/gm, "");
const compiled = ts.transpileModule(`${speechTiming}\n${source}\nexport { fitNarrationToDuration, fitSceneNarration, fitScenesNarration, narrationComfortIssue };`, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const {
  fitNarrationToDuration,
  fitSceneNarration,
  fitScenesNarration,
  narrationComfortIssue
} = await import(moduleUrl);

const chineseLong = "这是一段明显过长的中文旁白内容，它试图在短短三秒内讲完完整背景、核心卖点、用户收益和最终行动，因此一定会让配音变得非常急促。";
const fittedChinese = fitNarrationToDuration(chineseLong, 3);
assert.ok(fittedChinese.length < chineseLong.length);
assert.equal(narrationComfortIssue(fittedChinese, 3), undefined);

const englishLong = "This narration is far too long for a four second shot because it tries to explain the context, product value, workflow, proof, and final call to action at once.";
const fittedEnglish = fitNarrationToDuration(englishLong, 4);
assert.ok(fittedEnglish.split(/\s+/).length < englishLong.split(/\s+/).length);
assert.equal(narrationComfortIssue(fittedEnglish, 4), undefined);

const scene = {
  id: "scene-1",
  sceneNumber: 1,
  title: "长旁白",
  voiceover: chineseLong,
  visualPrompt: "微距特写，一个真实物件在工作室桌面上被光线照亮，前景中景背景层次清楚。",
  motionPrompt: "摄影机缓慢推近主体，光线沿桌面移动并带出下一镜头。",
  durationSeconds: 3,
  style: { theme: "电影质感", palette: ["#111", "#eee"], mood: "清晰" },
  assets: []
};
const fittedScene = fitSceneNarration(scene);
assert.ok(fittedScene.voiceover.length < scene.voiceover.length);
assert.equal(fittedScene.durationSeconds, 3);

const fittedScenes = fitScenesNarration([
  { ...scene, sceneNumber: 1, durationSeconds: 6 },
  { ...scene, id: "scene-2", sceneNumber: 2, voiceover: "一句短旁白。", durationSeconds: 6 },
  { ...scene, id: "scene-3", sceneNumber: 3, voiceover: "最后清楚收束成果。", durationSeconds: 6 }
], 18);
assert.equal(fittedScenes.reduce((sum, item) => sum + item.durationSeconds, 0), 18);
assert.ok(fittedScenes.every((item) => narrationComfortIssue(item.voiceover, item.durationSeconds) !== "too-long"));

console.log("Narration fit smoke checks passed.");
