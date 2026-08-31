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
const { exactVisualStyleDirection, visualStyleDirection, visualStyleProfile, visualStyleProfiles } = module.exports;

const inferenceSource = fs.readFileSync(new URL("../lib/visual-style-inference.ts", import.meta.url), "utf8");
const inferenceOutput = ts.transpileModule(inferenceSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const inferenceModule = { exports: {} };
vm.runInNewContext(inferenceOutput, {
  module: inferenceModule,
  exports: inferenceModule.exports,
  require: (id) => id.includes("visual-style-profiles") ? { visualStyleProfile } : {}
});
const { inferAutoVisualStyleId, repairLegacyAutoVisualStyle, resolveAutoVisualStyleOptions } = inferenceModule.exports;

const styles = ["电影质感", "极简高级", "明快有活力", "温暖自然"];
const palettes = styles.map((style) => visualStyleProfile(style).palette.join(","));
assert.equal(new Set(palettes).size, styles.length, "every preset should have a distinct palette");
assert.match(visualStyleDirection("电影质感"), /low-key|rim light|35mm|volumetric/i);
assert.match(visualStyleDirection("极简高级"), /minimalist|negative space|softbox|symmetry/i);
assert.match(visualStyleDirection("明快有活力"), /energetic|high-key|accent colors|rhythmic/i);
assert.match(visualStyleDirection("温暖自然"), /warm|window light|human-centered|wood/i);
assert.equal(Object.keys(visualStyleProfiles).length, 4);
assert.match(exactVisualStyleDirection({ visualStyleId: "pixel-art", visualStyleLabel: "像素游戏" }), /STRICT 2D PIXEL ART ONLY/);
assert.match(exactVisualStyleDirection({ visualStyleId: "chalkboard" }), /chalk drawing only/i);
assert.match(exactVisualStyleDirection({ visualStyleId: "collage" }), /No newspapers, magazines, printed fragments, typography/);
assert.equal(inferAutoVisualStyleId("做一个包子铺的视频宣传片"), "cinematic-realism");
assert.equal(inferAutoVisualStyleId("制作图书馆宣传视频"), "cinematic-realism");
assert.equal(inferAutoVisualStyleId("Create a cafe promotional film"), "cinematic-realism");
assert.equal(inferAutoVisualStyleId("生成 AI SaaS 产品宣传视频"), "product-ui");
assert.equal(inferAutoVisualStyleId("为企业风险治理平台制作产品介绍视频"), "product-ui");
assert.equal(inferAutoVisualStyleId("说明销售团队如何降低客户流失风险"), "cinematic-realism");
assert.equal(inferAutoVisualStyleId("制作项目风险预警流程说明视频"), "isometric");
assert.equal(inferAutoVisualStyleId("为工地制作安全操作培训视频"), "safety-poster");
assert.equal(inferAutoVisualStyleId("制作网络钓鱼邮件识别培训"), "safety-poster");
assert.equal(inferAutoVisualStyleId("制作拼贴纸艺风格的包子铺宣传片"), "collage");
assert.equal(inferAutoVisualStyleId("介绍一个没有明显类别的新主题"), "cinematic-realism");
assert.equal(resolveAutoVisualStyleOptions("包子铺宣传片", {
  duration: "30",
  sceneCount: "5",
  language: "中文",
  style: "明快有活力",
  visualStyleId: "collage",
  visualStyleSource: "auto",
  motion: "camera"
}).visualStyleId, "cinematic-realism");
assert.equal(resolveAutoVisualStyleOptions("包子铺宣传片", {
  duration: "30",
  sceneCount: "5",
  language: "中文",
  style: "明快有活力",
  visualStyleId: "collage",
  visualStyleSource: "manual",
  motion: "camera"
}).visualStyleId, "collage");

const legacyProject = {
  id: "project-1",
  currentVersion: {
    id: "version-1",
    scenes: [{
      sceneNumber: 1,
      style: {
        theme: "paper collage",
        palette: ["#ffffff"],
        mood: "bright",
        visualStyleId: "collage",
        visualStyleLabel: "拼贴纸艺"
      },
      assets: [
        { id: "generated", type: "image", url: "generated", r2Key: "generated", metadata: { source: "generated-image" } },
        { id: "uploaded", type: "image", url: "uploaded", r2Key: "uploaded", metadata: { source: "user-upload" } },
        { id: "audio", type: "audio", url: "audio", r2Key: "audio", metadata: { source: "ai-speech" } }
      ]
    }]
  }
};
const repaired = repairLegacyAutoVisualStyle(legacyProject, "包子铺宣传片", {
  duration: "30",
  sceneCount: "5",
  language: "中文",
  style: "明快有活力",
  visualStyleId: "collage",
  motion: "camera"
});
assert.equal(repaired.options.visualStyleId, "cinematic-realism");
assert.equal(repaired.options.visualStyleSource, "auto");
assert.equal(repaired.project.currentVersion.scenes[0].style.visualStyleId, "cinematic-realism");
assert.equal(repaired.project.currentVersion.scenes[0].assets.some((asset) => asset.id === "generated"), false);
assert.equal(repaired.project.currentVersion.scenes[0].assets.some((asset) => asset.id === "uploaded"), true);
assert.equal(repaired.project.currentVersion.scenes[0].assets.some((asset) => asset.id === "audio"), true);
assert.equal(repairLegacyAutoVisualStyle(legacyProject, "包子铺宣传片", {
  duration: "30",
  sceneCount: "5",
  language: "中文",
  style: "明快有活力",
  visualStyleId: "collage",
  visualStyleSource: "manual",
  motion: "camera"
}), undefined);

const aiVideo = fs.readFileSync(new URL("../lib/ai-video.ts", import.meta.url), "utf8");
const videoBrain = fs.readFileSync(new URL("../lib/video-brain.ts", import.meta.url), "utf8");
const projectRoute = fs.readFileSync(new URL("../app/api/projects/route.ts", import.meta.url), "utf8");
const projectDetailRoute = fs.readFileSync(new URL("../app/api/projects/[projectId]/route.ts", import.meta.url), "utf8");
const imageRoute = fs.readFileSync(new URL("../app/api/assets/generate/route.ts", import.meta.url), "utf8");
const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
assert.match(aiVideo, /visualStyleDirection\(options\.style\)/);
assert.match(aiVideo, /visualStyleId: options\?\.visualStyleId/);
assert.match(aiVideo, /exactVisualStyleDirection\(options\)/);
assert.match(aiVideo, /visualBible:[\s\S]*palette: profile\.palette[\s\S]*lighting: profile\.lighting[\s\S]*cameraLanguage: profile\.cameraLanguage/);
assert.match(videoBrain, /visualStyleProfile\(options\.style\)/);
assert.match(videoBrain, /visualStyleId: options\?\.visualStyleId/);
assert.match(videoBrain, /theme: `\$\{profile\.label\} · \$\{profile\.artDirection\}`/);
assert.doesNotMatch(videoBrain, /theme: "统一电影纪实风格"/);
assert.match(projectRoute, /resolveAutoVisualStyleOptions\(generationPrompt, body\.options\)/);
assert.match(projectDetailRoute, /repairLegacyAutoVisualStyle\(snapshot\.project, originalPrompt, generation\.options\)/);
assert.match(projectDetailRoute, /replaceImages: true, updateStyles: true/);
assert.match(projectDetailRoute, /候选画面均未通过内容与风格质量检查/);
assert.match(imageRoute, /metadata\?\.source !== "free-stock-image"/);
assert.match(imageRoute, /quantity: billableCompletedScenes\.length/);
assert.match(workspace, /visualStyleById\(inferAutoVisualStyleId\(value\)\)/);
assert.match(workspace, /\?repairFailedAutoStyle=1/);

console.log("Visual style profile smoke checks passed.");
