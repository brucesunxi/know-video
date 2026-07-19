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
assert.equal(narrationVoiceProfiles.length, 3);
assert.equal(new Set(narrationVoiceProfiles.map((profile) => profile.azureVoice)).size, 3);
assert.equal(narrationVoiceProfiles.every((profile) => profile.sampleText.length > 20), true);
assert.equal(narrationVoiceProfiles.every((profile) => profile.useCase.includes("·")), true);
assert.equal(narrationVoiceProfiles.every((profile) => Number.isFinite(profile.pitch) && Number.isFinite(profile.rateOffset)), true);
assert.equal(narrationVoiceProfile("male-clear").label, "专业产品男声");
assert.equal(narrationVoiceProfile("male-deep").label, "沉稳品牌男声");
assert.equal(narrationVoiceProfile("female-natural").azureVoice, "zh-CN-XiaoxiaoNeural");
assert.equal(narrationVoiceProfile("unknown").id, DEFAULT_NARRATION_VOICE);
assert.equal(isNarrationVoice("male-deep"), true);
assert.equal(isNarrationVoice("unknown"), false);
assert.equal(narrationVoiceFromRequest("把第 2 场景改成自然女声"), "female-natural");
assert.equal(narrationVoiceFromRequest("全片换成沉稳、权威一点的男声"), "male-deep");
assert.equal(narrationVoiceFromRequest("使用清晰有活力的男声"), "male-clear");
assert.equal(narrationVoiceFromRequest("把画面改成浅色"), undefined);
assert.equal(narrationVoiceForBrief("面向年轻家庭的温暖智能投影仪短片"), "female-natural");
assert.equal(narrationVoiceForBrief("企业治理与金融风控纪录片"), "male-deep");
assert.equal(narrationVoiceForBrief("节奏明快的科技产品发布短片"), "male-clear");
assert.equal(narrationVoiceForBrief("儿童课程，但明确使用沉稳男声"), "male-deep");

console.log("Voice profile smoke checks passed.");
