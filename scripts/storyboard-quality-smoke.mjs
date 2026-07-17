import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/storyboard-quality.ts", import.meta.url), "utf8")
  .replace(/^import type .*$/gm, "");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const { detectedShotVariety, storyboardQualityIssues } = await import(moduleUrl);

const palettes = ["#0B1220", "#27C4B8", "#F3C969"];
const makeScene = (sceneNumber, title, voiceover, visualPrompt, motionPrompt) => ({
  id: `scene-${sceneNumber}`,
  sceneNumber,
  title,
  voiceover,
  visualPrompt,
  motionPrompt,
  durationSeconds: 6,
  style: { theme: "电影纪实", palette: palettes, mood: "克制而有力量" },
  assets: []
});

const scenes = [
  makeScene(1, "灵感点亮", "清晨一束光，让模糊想法拥有清晰形状。", "微距特写 macro shot，一颗暖金色光点从创作者指尖升起，位于安静的深色工作室桌面；前景是带细微划痕的金属旋钮，中景是人物专注的手，背景灯光化成柔和景深，轮廓光勾勒玻璃与金属材质，冷青配色中保留一束暖光，画面中心构图明确且富有呼吸感。", "镜头缓慢推近光点，人物手指轻微转动，背景光斑沿景深方向持续漂移，前景与背景形成清晰视差，最后由金色光轨向右牵引进入下一幕。"),
  makeScene(2, "故事成形", "随后，零散线索被整理成可执行的故事路径。", "俯拍广角 wide shot，纸张、照片和半透明胶片在明亮制作台上组成连续故事线；前景铅笔滚过木质桌面，中景双手调整画面顺序，背景工作室墙面留出环境层次，侧逆光穿过玻璃边缘，青灰与暖金配色统一，鸟瞰构图让每个节点都有清晰空间关系。", "摄影机沿桌面上方平稳横移，卡片依次翻面并靠拢，人物双手完成最后一次排序，前中后景保持连续运动，胶片边缘的光线逐渐带出下一场空间。"),
  makeScene(3, "画面苏醒", "此刻，每个镜头都在统一世界里真实发生。", "中景 medium shot，一位创作者站在沉浸式工作室中央观看巨幅画面苏醒；前景透明玻璃反射流动光线，中景人物与发光屏幕形成对角构图，背景空间向远处延伸形成深度，柔和顶光和轮廓光刻画织物与金属材质，冷青主色中点缀暖金，环境真实且具有电影质感。", "镜头围绕人物轻缓弧移，屏幕中的云层与人物衣角同步运动，前景反射和背景光带产生明显视差，发光画面逐渐铺满镜头并完成自然转场。"),
  makeScene(4, "从容交付", "最终，创意与节奏汇成完整作品，抵达观众。", "低机位远景 low angle，一块完成影片的宽幅银幕矗立在开阔放映空间；前景深色座椅形成引导线，中景观众剪影保持克制，背景银幕与建筑结构构成稳定中心，顶部柔光和银幕反射照亮混凝土与织物材质，冷青、炭黑和暖金色彩收束统一，画面庄重但不夸张。", "摄影机从低机位缓慢后移，银幕画面平稳播放，观众轮廓产生轻微呼吸感，前景座椅形成稳定视差，环境光逐步收束到品牌色并在最终构图中停留。")
];

const validIssues = storyboardQualityIssues(scenes, { language: "中文", style: "电影感", duration: "30", sceneCount: "4" }, "创意成片");
assert.equal(detectedShotVariety(scenes), 4, "four distinct shot directions should be detected");
assert.deepEqual(validIssues, [], `valid storyboard failed: ${validIssues.join(", ")}`);

const mutate = (index, values) => scenes.map((scene, current) => current === index ? { ...scene, ...values } : scene);
assert(storyboardQualityIssues(mutate(0, { visualPrompt: "A plain studio dashboard with cards and grids and no useful art direction details." }), { language: "中文" }).includes("scene content is not fully localized in Chinese"));
assert(storyboardQualityIssues(scenes.map((scene) => ({ ...scene, visualPrompt: scenes[0].visualPrompt })), { language: "中文" }).includes("scene visuals are too repetitive"));
assert(storyboardQualityIssues(scenes.map((scene) => ({ ...scene, visualPrompt: scene.visualPrompt.replace(/^[^，,]+/u, "中等景别 medium shot") })), { language: "中文" }).includes("shot scale and camera angle lack variety"));
assert(storyboardQualityIssues(scenes.map((scene) => ({ ...scene, voiceover: `现在开始讲述故事${scene.voiceover}` })), { language: "中文" }).includes("voiceover openings repeat mechanically"));
assert(storyboardQualityIssues(mutate(1, { visualPrompt: "人物出现，内容空泛，没有可执行的画面细节。" }), { language: "中文" }).includes("visual direction lacks production-ready composition details"));
assert(storyboardQualityIssues(mutate(2, { voiceover: "这是一段明显过长而且无法在六秒时间里自然说完的旁白内容，它会让配音变得非常急促，也破坏整支影片原本应有的呼吸和节奏。" }), { language: "中文" }).includes("voiceover does not fit comfortably inside its scene duration"));

console.log("Storyboard quality smoke passed.");
