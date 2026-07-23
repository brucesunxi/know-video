import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function compileCommonJs(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
}

const semanticsModule = { exports: {} };
vm.runInNewContext(
  compileCommonJs(fs.readFileSync(new URL("../lib/brief-semantics.ts", import.meta.url), "utf8")),
  { module: semanticsModule, exports: semanticsModule.exports }
);

const styleProfile = {
  label: "电影质感",
  artDirection: "真实游戏世界与电影化光影",
  palette: ["#101015", "#5d4736", "#f5c46b", "#faf7f0"],
  lighting: "方向明确的体积光与角色轮廓光",
  cameraLanguage: "稳定推进与清晰动作视差",
  materials: "石材、金属与织物",
  composition: "前中后景层次清楚",
  avoid: "企业办公室、控制台、漂浮数据卡片"
};

const videoBrainModule = { exports: {} };
const mockRequire = (id) => {
  if (id === "@/lib/brief-semantics") return semanticsModule.exports;
  if (id === "@/lib/narration-fit") return { fitSceneNarration: (scene) => scene };
  if (id === "@/lib/voice-profiles") {
    return {
      narrationVoiceForBrief: () => "zh-CN-YunxiNeural",
      narrationVoiceFromRequest: () => undefined
    };
  }
  if (id === "@/lib/visual-style-profiles") {
    return {
      visualStyleDirection: () => styleProfile.artDirection,
      visualStyleProfile: () => styleProfile
    };
  }
  if (id === "@/lib/edit-intent") {
    return { analyzeEditIntent: () => ({}), requestsGeneratedClip: () => false };
  }
  if (id === "@/lib/production-edit-intent") {
    return { isProductionOnlyRequest: () => false, productionSettingsFromRequest: () => undefined };
  }
  throw new Error(`Unexpected import in video-brain smoke test: ${id}`);
};
vm.runInNewContext(
  compileCommonJs(fs.readFileSync(new URL("../lib/video-brain.ts", import.meta.url), "utf8")),
  {
    module: videoBrainModule,
    exports: videoBrainModule.exports,
    require: mockRequire,
    crypto: { randomUUID },
    console
  }
);

const project = videoBrainModule.exports.generateProjectFromPrompt(
  "请为一款 DIY 沙盒游戏制作 30 秒介绍片，展示玩家建造关卡、角色成长和不同策略带来的结果。",
  undefined,
  {
    duration: "30",
    sceneCount: "5",
    language: "中文",
    style: "电影质感",
    motion: "camera",
    videoTier: "economy"
  }
);

const narration = project.currentVersion.scenes.map((scene) => scene.voiceover).join("\n");
const visuals = project.currentVersion.scenes.map((scene) => scene.visualPrompt).join("\n");
const titles = project.currentVersion.scenes.map((scene) => scene.title);

assert.equal(titles.join("|"), "进入游戏|玩法上手|挑战升级|策略变化|开始下一局");
assert.match(narration, /玩家|玩法|游戏/u);
assert.doesNotMatch(narration, /项目压力|授权|责任链|证据包|业务材料|风险信号/u);
assert.match(visuals, /玩家角色|关卡|游戏世界/u);
assert.doesNotMatch(visuals, /企业治理|授权责任链|证据包|商业环境/u);

console.log("Domain-aware fallback smoke passed.");
