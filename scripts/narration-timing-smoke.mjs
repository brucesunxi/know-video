import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/narration-timing.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require: () => ({}) });
const { activeNarrationCaption, narrationAudioPlaybackRate, narrationCaptionCues, narrationDurationInFrames } = module.exports;

assert.deepEqual(
  Array.from(narrationCaptionCues("先理解需求，再生成画面。最后完成视频！")),
  ["先理解需求，", "再生成画面。", "最后完成视频！"]
);
assert.ok(narrationCaptionCues("这是一个没有标点而且长度明显超过单行字幕限制的中文旁白内容").every((cue) => cue.length <= 15));
assert.deepEqual(
  Array.from(narrationCaptionCues("实时生成高质量视频资产支持多风格和自然中文配音")),
  ["实时生成高质量视频", "资产支持多风格和自然中文配音"]
);
assert.deepEqual(
  Array.from(narrationCaptionCues("系统会根据品牌风格和受众需求快速生成统一视觉")),
  ["系统会根据品牌风格和", "受众需求快速生成统一视觉"]
);
assert.deepEqual(
  Array.from(narrationCaptionCues("Create a polished product video with clear pacing and a confident natural voice.")),
  ["Create a polished product video with clear pacing", "and a confident natural voice."]
);

const audio = {
  type: "audio",
  url: "/voice.wav",
  metadata: { actualDurationSeconds: 3.2 }
};
assert.equal(narrationDurationInFrames({ assets: [audio] }, 30, 1, 180), 96);
assert.equal(narrationDurationInFrames({ assets: [audio] }, 30, 1.25, 180), 77);
assert.equal(narrationDurationInFrames({ assets: [{ ...audio, metadata: {} }] }, 30, 1, 180), 180);
assert.equal(narrationDurationInFrames({ assets: [] }, 30, 1, 180), 0);

const shortAudio = {
  type: "audio",
  url: "/short.wav",
  metadata: { actualDurationSeconds: 1.8 }
};
assert.equal(narrationAudioPlaybackRate({ assets: [shortAudio] }, 1, 180, 30), 1);
assert.equal(narrationDurationInFrames({ assets: [shortAudio] }, 30, 1, 180), 54);

const text = "第一句。第二句更长一些。";
const first = activeNarrationCaption(text, 0, 120);
const final = activeNarrationCaption(text, 119, 120);
assert.equal(first.text, "第一句。");
assert.equal(final.text, "第二句更长一些。");
assert.equal(activeNarrationCaption(text, 120, 120), undefined);

console.log("Narration timing smoke checks passed.");
