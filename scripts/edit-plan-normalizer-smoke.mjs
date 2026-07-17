import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
}

const intentModule = { exports: {} };
const intentSource = fs.readFileSync(new URL("../lib/edit-intent.ts", import.meta.url), "utf8");
vm.runInNewContext(transpile(intentSource), {
  module: intentModule,
  exports: intentModule.exports
});
const languageQualityModule = { exports: {} };
const languageQualitySource = fs.readFileSync(new URL("../lib/language-quality.ts", import.meta.url), "utf8");
vm.runInNewContext(transpile(languageQualitySource), {
  module: languageQualityModule,
  exports: languageQualityModule.exports
});

const source = fs.readFileSync(new URL("../lib/edit-plan-normalizer.ts", import.meta.url), "utf8");
const output = transpile(source);
const module = { exports: {} };
vm.runInNewContext(output, {
  module,
  exports: module.exports,
  require: (specifier) => {
    if (specifier === "@/lib/edit-intent") return intentModule.exports;
    if (specifier === "@/lib/language-quality") return languageQualityModule.exports;
    return {};
  }
});
const { normalizeEditPlanAgainstScenes } = module.exports;

const scene = {
  id: "scene-1",
  sceneNumber: 1,
  title: "Original",
  voiceover: "Original narration",
  visualPrompt: "Original visual",
  motionPrompt: "Original motion",
  durationSeconds: 5,
  style: { theme: "dark", palette: ["#000", "#fff"], mood: "focused" },
  assets: []
};
const basePlan = {
  id: "plan-1",
  editNumber: 1,
  baseVersionId: "version-1",
  status: "proposed",
  userRequest: "test",
  summary: "test",
  affectedScenes: [1],
  changes: [],
  createdAt: new Date(0).toISOString()
};
const side = {
  title: scene.title,
  voiceover: scene.voiceover,
  thumbnailTone: "dark",
  visualPrompt: scene.visualPrompt,
  motionPrompt: scene.motionPrompt
};

const visual = normalizeEditPlanAgainstScenes({
  ...basePlan,
  changes: [{
    sceneNumber: 1,
    status: "updated",
    before: { ...side, visualPrompt: "Untrusted before value" },
    after: { ...side, visualPrompt: "New visual" },
    regenerate: ["audio"]
  }]
}, [scene]);
assert.deepEqual(Array.from(visual.changes[0].regenerate), ["image", "thumbnail", "render"]);
assert.equal(visual.changes[0].before.visualPrompt, scene.visualPrompt);

const narration = normalizeEditPlanAgainstScenes({
  ...basePlan,
  changes: [{
    sceneNumber: 1,
    status: "updated",
    before: side,
    after: { ...side, voiceover: "New narration" },
    regenerate: []
  }]
}, [scene]);
assert.deepEqual(Array.from(narration.changes[0].regenerate), ["audio", "caption", "render"]);

const unchanged = normalizeEditPlanAgainstScenes({
  ...basePlan,
  affectedScenes: [1, 99],
  changes: [
    { sceneNumber: 1, status: "updated", before: side, after: side, regenerate: ["image", "audio"] },
    { sceneNumber: 99, status: "updated", before: side, after: side, regenerate: ["image"] }
  ]
}, [scene]);
assert.deepEqual(Array.from(unchanged.affectedScenes), []);
assert.deepEqual(Array.from(unchanged.changes), []);

const localization = normalizeEditPlanAgainstScenes({
  ...basePlan,
  userRequest: "把语言都改为中文",
  changes: [{
    sceneNumber: 1,
    status: "updated",
    before: side,
    after: {
      ...side,
      title: "中文标题",
      voiceover: "中文旁白",
      visualPrompt: "与原画面语义一致的中文描述",
      motionPrompt: "与原镜头运动一致的中文描述"
    },
    regenerate: ["image", "audio", "thumbnail", "caption", "render"]
  }]
}, [scene]);
assert.deepEqual(Array.from(localization.changes[0].regenerate), ["audio", "caption", "render"]);

const localizedRestyle = normalizeEditPlanAgainstScenes({
  ...basePlan,
  userRequest: "把全片改成中文，并换成明亮的视觉风格",
  changes: [{
    sceneNumber: 1,
    status: "updated",
    before: side,
    after: {
      ...side,
      title: "中文标题",
      voiceover: "中文旁白",
      thumbnailTone: "light",
      visualPrompt: "明亮风格的中文画面描述",
      motionPrompt: "中文镜头运动"
    },
    regenerate: []
  }]
}, [scene]);
assert.deepEqual(
  Array.from(localizedRestyle.changes[0].regenerate),
  ["image", "thumbnail", "audio", "caption", "render"]
);

const secondScene = {
  ...scene,
  id: "scene-2",
  sceneNumber: 2,
  title: "Second",
  voiceover: "Second narration"
};
const secondSide = {
  ...side,
  title: secondScene.title,
  voiceover: secondScene.voiceover
};
const scoped = normalizeEditPlanAgainstScenes({
  ...basePlan,
  userRequest: "只修改第 2 个场景的标题",
  affectedScenes: [1, 2],
  changes: [
    {
      sceneNumber: 1,
      status: "updated",
      before: side,
      after: { ...side, title: "Model changed the wrong scene" },
      regenerate: ["caption", "render"]
    },
    {
      sceneNumber: 2,
      status: "updated",
      before: secondSide,
      after: { ...secondSide, title: "Only this scene changes" },
      regenerate: []
    }
  ]
}, [scene, secondScene]);
assert.deepEqual(Array.from(scoped.affectedScenes), [2]);
assert.equal(scoped.changes[0].after.title, "Only this scene changes");

const globalWithExclusion = normalizeEditPlanAgainstScenes({
  ...basePlan,
  userRequest: "把所有场景都改成浅色，但第 2 场保持不变",
  affectedScenes: [1],
  changes: [{
    sceneNumber: 1,
    status: "updated",
    before: side,
    after: { ...side, thumbnailTone: "light", visualPrompt: "Bright first scene" },
    regenerate: []
  }]
}, [scene, secondScene]);
assert.deepEqual(Array.from(globalWithExclusion.affectedScenes), [1]);
assert.equal(globalWithExclusion.changes[0].sceneNumber, 1);

assert.throws(() => normalizeEditPlanAgainstScenes({
  ...basePlan,
  userRequest: "把所有场景都改成浅色，但第 2 场保持不变",
  affectedScenes: [1, 2],
  changes: [{
    sceneNumber: 1,
    status: "updated",
    before: side,
    after: { ...side, thumbnailTone: "light", visualPrompt: "Bright first scene" },
    regenerate: []
  }, {
    sceneNumber: 2,
    status: "updated",
    before: secondSide,
    after: { ...secondSide, thumbnailTone: "light", visualPrompt: "Excluded scene must not change" },
    regenerate: []
  }]
}, [scene, secondScene]), /没有覆盖所有目标场景/);

assert.throws(() => normalizeEditPlanAgainstScenes({
  ...basePlan,
  userRequest: "把全片改成浅色",
  affectedScenes: [1],
  changes: [{
    sceneNumber: 1,
    status: "updated",
    before: side,
    after: { ...side, thumbnailTone: "light", visualPrompt: "Bright first scene" },
    regenerate: []
  }]
}, [scene, secondScene]), /没有覆盖所有目标场景/);

const completeGlobal = normalizeEditPlanAgainstScenes({
  ...basePlan,
  userRequest: "把全片改成浅色",
  affectedScenes: [1, 2],
  changes: [{
    sceneNumber: 1,
    status: "updated",
    before: side,
    after: { ...side, thumbnailTone: "light", visualPrompt: "Bright first scene" },
    regenerate: []
  }, {
    sceneNumber: 2,
    status: "updated",
    before: secondSide,
    after: { ...secondSide, thumbnailTone: "light", visualPrompt: "Bright second scene" },
    regenerate: []
  }]
}, [scene, secondScene]);
assert.deepEqual(Array.from(completeGlobal.affectedScenes), [1, 2]);

assert.throws(() => normalizeEditPlanAgainstScenes({
  ...basePlan,
  userRequest: "把全片语言都改为中文",
  affectedScenes: [1, 2],
  changes: [{
    sceneNumber: 1,
    status: "updated",
    before: side,
    after: { ...side, title: "中文标题", voiceover: "中文旁白", visualPrompt: "中文画面", motionPrompt: "中文运镜" },
    regenerate: []
  }, {
    sceneNumber: 2,
    status: "updated",
    before: secondSide,
    after: { ...secondSide, title: "中文标题", voiceover: "中文旁白", visualPrompt: "Still English", motionPrompt: "中文运镜" },
    regenerate: []
  }]
}, [scene, secondScene]), /未完成的中文字段/);

assert.throws(() => normalizeEditPlanAgainstScenes({
  ...basePlan,
  userRequest: "把全片语言都改为中文",
  affectedScenes: [1, 2],
  changes: [{
    sceneNumber: 1,
    status: "updated",
    before: side,
    after: { ...side, title: "Customization 中文", voiceover: "中文旁白", visualPrompt: "中文画面", motionPrompt: "中文运镜" },
    regenerate: []
  }, {
    sceneNumber: 2,
    status: "updated",
    before: secondSide,
    after: { ...secondSide, title: "中文标题", voiceover: "Know Video 的 AI 中文旁白", visualPrompt: "保留 Know Video 产品名的中文画面", motionPrompt: "中文运镜" },
    regenerate: []
  }]
}, [scene, secondScene]), /未完成的中文字段/);

const localizedWithAllowedProductTerms = normalizeEditPlanAgainstScenes({
  ...basePlan,
  userRequest: "把全片语言都改为中文",
  affectedScenes: [1, 2],
  changes: [{
    sceneNumber: 1,
    status: "updated",
    before: side,
    after: { ...side, title: "Know Video 中文开场", voiceover: "AI 创作流程进入中文旁白。", visualPrompt: "Know Video 工作台以中文界面展示分镜规划。", motionPrompt: "镜头沿着中文时间线缓慢推进。" },
    regenerate: []
  }, {
    sceneNumber: 2,
    status: "updated",
    before: secondSide,
    after: { ...secondSide, title: "中文第二幕", voiceover: "SaaS 团队看到清晰的中文版本。", visualPrompt: "中文仪表盘展示版本记录和 MP4 导出状态。", motionPrompt: "镜头从 UI 卡片平滑拉近。" },
    regenerate: []
  }]
}, [scene, secondScene]);
assert.deepEqual(Array.from(localizedWithAllowedProductTerms.affectedScenes), [1, 2]);

const unsupportedTopology = normalizeEditPlanAgainstScenes({
  ...basePlan,
  changes: [{
    sceneNumber: 1,
    status: "deleted",
    before: side,
    after: { ...side, title: "Should never apply" },
    regenerate: ["render"]
  }]
}, [scene]);
assert.deepEqual(Array.from(unsupportedTopology.changes), []);

const voiceChange = normalizeEditPlanAgainstScenes({
  ...basePlan,
  userRequest: "把第 1 场景换成自然女声",
  changes: [{
    sceneNumber: 1,
    status: "updated",
    before: side,
    after: { ...side, narrationVoice: "female-natural" },
    regenerate: []
  }]
}, [scene]);
assert.equal(voiceChange.changes[0].after.narrationVoice, "female-natural");
assert.deepEqual(Array.from(voiceChange.changes[0].regenerate), ["audio", "render"]);

const generatedClip = normalizeEditPlanAgainstScenes({
  ...basePlan,
  userRequest: "让第 1 场景动起来",
  changes: [{ sceneNumber: 1, status: "updated", before: side, after: side, regenerate: [] }]
}, [scene]);
assert.deepEqual(Array.from(generatedClip.changes[0].regenerate), ["clip", "render"]);

const ambiguousClip = normalizeEditPlanAgainstScenes({
  ...basePlan,
  userRequest: "生成动态镜头",
  changes: [{ sceneNumber: 1, status: "updated", before: side, after: side, regenerate: ["clip"] }]
}, [scene]);
assert.deepEqual(Array.from(ambiguousClip.changes), []);

const sceneWithClip = {
  ...scene,
  assets: [{ id: "clip-1", type: "clip", url: "/api/assets/clip-1" }]
};
const restyledClip = normalizeEditPlanAgainstScenes({
  ...basePlan,
  userRequest: "把第 1 场景改成明亮的视觉风格",
  changes: [{
    sceneNumber: 1,
    status: "updated",
    before: side,
    after: { ...side, thumbnailTone: "light", visualPrompt: "Bright visual" },
    regenerate: []
  }]
}, [sceneWithClip]);
assert.deepEqual(Array.from(restyledClip.changes[0].regenerate), ["image", "thumbnail", "clip", "render"]);

console.log("Edit plan normalization smoke checks passed.");
