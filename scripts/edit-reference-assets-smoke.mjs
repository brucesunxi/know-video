import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/edit-reference-assets.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
const globalRequest = (request) => /全片|所有场景|每个场景|entire video|all scenes/iu.test(request);
vm.runInNewContext(output, {
  module,
  exports: module.exports,
  require: (specifier) => specifier === "@/lib/edit-intent"
    ? {
        analyzeEditIntent: (request) => ({ global: globalRequest(request) }),
        globalEditTargetSceneNumbers: (request, sceneNumbers) => globalRequest(request) ? [...sceneNumbers] : []
      }
    : {}
});

const { bindReferenceAssetsToPlan } = module.exports;
const side = (sceneNumber) => ({
  title: `场景 ${sceneNumber}`,
  voiceover: `原旁白 ${sceneNumber}`,
  narrationVoice: "male-clear",
  thumbnailTone: "dark",
  visualPrompt: `原画面 ${sceneNumber}`,
  motionPrompt: "缓慢推进"
});
const version = {
  id: "version-1",
  scenes: [1, 2, 3].map((sceneNumber) => ({
    id: `scene-${sceneNumber}`,
    sceneNumber,
    durationSeconds: 6,
    ...side(sceneNumber),
    style: { narrationVoice: "male-clear", theme: "dark" }
  }))
};
const plan = (userRequest, affectedScenes = [2]) => ({
  id: "plan-1",
  editNumber: 1,
  baseVersionId: version.id,
  status: "proposed",
  userRequest,
  summary: "修改视频",
  affectedScenes,
  changes: [],
  createdAt: new Date(0).toISOString()
});
const imageReference = {
  key: "uploads/generation/request/product.png",
  name: "product.png",
  size: 1200,
  contentType: "image/png",
  analysisKind: "visual",
  analysis: "银色设备放在白色桌面上"
};

const productionLogo = bindReferenceAssetsToPlan({
  plan: {
    ...plan("把这张上传图片作为全片 Logo", []),
    productionAssets: { logo: { action: "attach-upload" } }
  },
  references: [imageReference],
  version
});
assert.deepEqual(Array.from(productionLogo.affectedScenes), []);
assert.equal(productionLogo.changes.length, 0);
assert.equal(productionLogo.productionAssets.logo.referenceKey, imageReference.key);
assert.equal(productionLogo.referenceAssets[0].referenceUsage, "production-logo");

const targeted = bindReferenceAssetsToPlan({
  plan: plan("让场景 2 参考这张图"),
  references: [imageReference],
  version,
  selectedSceneNumber: 2
});
assert.deepEqual(Array.from(targeted.affectedScenes), [2]);
assert.equal(targeted.changes.length, 1);
assert.equal(targeted.changes[0].sceneNumber, 2);
assert.match(targeted.changes[0].after.visualPrompt, /银色设备放在白色桌面上/);
assert.deepEqual(Array.from(targeted.changes[0].regenerate), ["image", "thumbnail", "render"]);
assert.deepEqual(Array.from(targeted.referenceAssets[0].targetSceneNumbers), [2]);

const global = bindReferenceAssetsToPlan({
  plan: {
    ...plan("让全片所有场景都参考这张图", [3]),
    changes: [{
      sceneNumber: 3,
      status: "updated",
      before: side(3),
      after: { ...side(3), title: "更新后的第三幕" },
      regenerate: ["render"]
    }]
  },
  references: [imageReference],
  version,
  selectedSceneNumber: 3
});
assert.deepEqual(Array.from(global.affectedScenes), [1, 2, 3]);
assert.deepEqual(Array.from(global.changes, (change) => change.sceneNumber), [1, 2, 3]);
assert.equal(global.changes.every((change) => change.after.visualPrompt.includes("银色设备放在白色桌面上")), true);
assert.equal(global.changes[2].after.title, "更新后的第三幕");
assert.deepEqual(Array.from(global.referenceAssets[0].targetSceneNumbers), [1, 2, 3]);

const audioReference = {
  key: "uploads/generation/request/voice.wav",
  name: "voice.wav",
  size: 1800,
  contentType: "audio/wav",
  analysisKind: "transcript",
  analysis: "把复杂知识讲得清楚，也讲得好看。"
};
const productionMusic = bindReferenceAssetsToPlan({
  plan: {
    ...plan("把这个音频作为背景音乐", []),
    productionAssets: { music: { action: "attach-upload" } }
  },
  references: [audioReference],
  version
});
assert.deepEqual(Array.from(productionMusic.affectedScenes), []);
assert.equal(productionMusic.changes.length, 0);
assert.equal(productionMusic.productionAssets.music.referenceKey, audioReference.key);
assert.equal(productionMusic.referenceAssets[0].referenceUsage, "production-music");

assert.throws(() => bindReferenceAssetsToPlan({
  plan: {
    ...plan("把上传图片作为 Logo", []),
    productionAssets: { logo: { action: "attach-upload" } }
  },
  references: [],
  version
}), /请上传一张图片/);
const transcript = bindReferenceAssetsToPlan({
  plan: plan("用这个录音内容作为第 2 个场景的旁白"),
  references: [audioReference],
  version,
  selectedSceneNumber: 2
});
assert.equal(transcript.changes[0].after.voiceover, audioReference.analysis);
assert.deepEqual(Array.from(transcript.changes[0].regenerate), ["audio", "caption", "render"]);

const styleOnly = bindReferenceAssetsToPlan({
  plan: plan("参考这个音频的语气调整第 2 个场景"),
  references: [audioReference],
  version,
  selectedSceneNumber: 2
});
assert.equal(styleOnly.changes.length, 0);
assert.equal(styleOnly.referenceAssets[0].targetSceneNumber, 2);

const videoReference = {
  key: "uploads/generation/request/source.mp4",
  name: "source.mp4",
  size: 24_000,
  contentType: "video/mp4",
  actualDurationSeconds: 4.8
};
const directVideo = bindReferenceAssetsToPlan({
  plan: plan("把这段视频作为第 2 个场景的画面"),
  references: [videoReference],
  version,
  selectedSceneNumber: 2
});
assert.deepEqual(Array.from(directVideo.changes[0].regenerate), ["render"]);
assert.equal(directVideo.referenceAssets[0].referenceUsage, "source-media");
assert.match(directVideo.summary, /直接用于场景 2/);

const directAudio = bindReferenceAssetsToPlan({
  plan: plan("直接使用这段录音作为第 2 个场景的配音"),
  references: [{ ...audioReference, actualDurationSeconds: 4.2 }],
  version,
  selectedSceneNumber: 2
});
assert.equal(directAudio.changes[0].after.voiceover, audioReference.analysis);
assert.deepEqual(Array.from(directAudio.changes[0].regenerate), ["caption", "render"]);
assert.equal(directAudio.referenceAssets[0].referenceUsage, "source-media");

assert.throws(() => bindReferenceAssetsToPlan({
  plan: plan("直接使用这段录音作为第 2 个场景的配音"),
  references: [{ ...audioReference, actualDurationSeconds: 12 }],
  version,
  selectedSceneNumber: 2
}), /超过场景 2/);

console.log("Edit reference asset smoke checks passed.");
