import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/voice-profiles.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require: () => ({}) });
const {
  DEFAULT_NARRATION_VOICE,
  isNarrationVoice,
  narrationVoiceFromRequest,
  narrationVoiceForBrief,
  narrationVoiceProfile,
  narrationVoiceProfiles
} = module.exports;

assert.equal(DEFAULT_NARRATION_VOICE, "male-clear");
assert.equal(narrationVoiceProfiles.length, 9);
assert.equal(new Set(narrationVoiceProfiles.map((profile) => profile.azureVoiceZh)).size, 9);
assert.equal(new Set(narrationVoiceProfiles.map((profile) => profile.azureVoiceEn)).size, 9);
assert.equal(narrationVoiceProfiles.every((profile) => profile.sampleText.length > 20), true);
assert.equal(narrationVoiceProfiles.every((profile) => profile.useCase.includes("·")), true);
assert.equal(narrationVoiceProfiles.every((profile) => Number.isFinite(profile.pitch) && !("rateOffset" in profile)), true);
assert.equal(narrationVoiceProfile("male-clear").label, "清晰活力男声");
assert.equal(narrationVoiceProfile("male-deep").label, "沉稳品牌男声");
assert.equal(narrationVoiceProfile("female-natural").azureVoiceZh, "zh-CN-XiaoxiaoNeural");
assert.equal(narrationVoiceProfile("female-natural").azureVoiceEn, "en-US-JennyNeural");
assert.equal(narrationVoiceProfile("male-documentary").azureVoiceZh, "zh-CN-YunjianNeural");
assert.equal(narrationVoiceProfile("male-youthful").azureVoiceEn, "en-US-EricNeural");
assert.equal(narrationVoiceProfile("female-warm").azureVoiceZh, "zh-CN-XiaoyiNeural");
assert.equal(narrationVoiceProfile("female-bright").azureVoiceEn, "en-US-NancyNeural");
assert.equal(narrationVoiceProfile("female-calm").azureVoiceZh, "zh-CN-XiaomoNeural");
assert.equal(narrationVoiceProfile("female-authoritative").azureVoiceEn, "en-US-ElizabethNeural");
assert.equal(narrationVoiceProfile("unknown").id, DEFAULT_NARRATION_VOICE);
assert.equal(isNarrationVoice("male-deep"), true);
assert.equal(isNarrationVoice("unknown"), false);
assert.equal(narrationVoiceFromRequest("把第 2 场景改成自然女声"), "female-natural");
assert.equal(narrationVoiceFromRequest("全片换成沉稳、权威一点的男声"), "male-deep");
assert.equal(narrationVoiceFromRequest("全片换成品牌男声"), "male-deep");
assert.equal(narrationVoiceFromRequest("使用清晰有活力的男声"), "male-clear");
assert.equal(narrationVoiceFromRequest("换成纪实纪录片男声"), "male-documentary");
assert.equal(narrationVoiceFromRequest("换成明亮活力女声"), "female-bright");
assert.equal(narrationVoiceFromRequest("使用舒缓讲解女声"), "female-calm");
assert.equal(narrationVoiceFromRequest("把画面改成浅色"), undefined);
assert.equal(narrationVoiceForBrief("面向年轻家庭的温暖智能投影仪短片"), "female-warm");
assert.equal(narrationVoiceForBrief("记录古城修复过程的历史纪录片"), "male-documentary");
assert.equal(narrationVoiceForBrief("企业治理与金融风控说明"), "male-deep");
assert.equal(narrationVoiceForBrief("为一家自动化公司制作企业介绍片"), "male-deep");
assert.equal(narrationVoiceForBrief("节奏明快的科技产品发布短片"), "male-clear");
assert.equal(narrationVoiceForBrief("做一套新员工操作课程和步骤讲解"), "female-calm");
assert.equal(narrationVoiceForBrief("新品发布的社交媒体活动宣传"), "female-bright");
assert.equal(narrationVoiceForBrief("儿童课程，但明确使用沉稳男声"), "male-deep");

console.log("Voice profile smoke checks passed.");
