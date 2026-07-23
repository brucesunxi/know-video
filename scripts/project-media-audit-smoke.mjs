import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/project-media-audit.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, {
  module,
  exports: module.exports,
  require: (specifier) => {
    if (specifier === "@/lib/clip-timing") return {
      resolvedClipPlaybackRate: ({ asset, sceneDurationSeconds, productionPlaybackRate }) => {
        const duration = Number(asset.metadata?.duration ?? asset.metadata?.actualDurationSeconds);
        const ratio = duration / sceneDurationSeconds;
        return ratio >= 0.25 && ratio <= 2 ? productionPlaybackRate * ratio : productionPlaybackRate;
      }
    };
    if (specifier === "@/lib/narration-fit") return { narrationComfortIssue: () => undefined };
    if (specifier === "@/lib/production-settings") return { productionSettingsFromScenes: () => ({ playbackRate: 1 }) };
    return {};
  }
});
const { auditProjectMedia } = module.exports;

const scene = (sceneNumber, overrides = {}) => ({
  id: `scene-${sceneNumber}`,
  sceneNumber,
  title: `场景 ${sceneNumber}`,
  voiceover: "清晰自然的中文旁白内容。",
  visualPrompt: "visual",
  motionPrompt: "motion",
  durationSeconds: 6,
  style: { theme: "dark", palette: ["#000"], mood: "calm", narrationVoice: "male-clear" },
  assets: [
    { id: `image-${sceneNumber}`, type: "image", r2Key: `image-${sceneNumber}`, url: "/image" },
    { id: `audio-${sceneNumber}`, type: "audio", r2Key: `audio-${sceneNumber}`, url: "/audio", metadata: { source: "ai-speech", actualDurationSeconds: 5.2, narrationVoice: "male-clear" } }
  ],
  ...overrides
});
const project = (scenes) => ({ id: "project", currentVersion: { id: "version", scenes } });

assert.equal(auditProjectMedia(project([scene(1)])).ready, true);

const legacy = auditProjectMedia(project([scene(1, {
  assets: [
    { id: "image", type: "image", r2Key: "image", url: "/image" },
    { id: "audio", type: "audio", r2Key: "audio", url: "/audio", metadata: { source: "ai-speech", model: "melotts", actualDurationSeconds: 7, narrationVoice: "female-natural" } }
  ]
})]));
assert.equal(legacy.ready, false);
assert.deepEqual(Array.from(legacy.errors, (issue) => issue.code), ["legacy-chinese-voice", "voice-mismatch"]);
assert.deepEqual(Array.from(legacy.repairAudioSceneNumbers), [1]);

const silentTail = auditProjectMedia(project([scene(1, {
  assets: [
    { id: "image", type: "image", r2Key: "image", url: "/image" },
    { id: "audio", type: "audio", r2Key: "audio", url: "/audio", metadata: { source: "ai-speech", actualDurationSeconds: 5.2, trailingSilenceSeconds: 3.2, narrationVoice: "male-clear" } }
  ]
})]));
assert.equal(silentTail.errors[0].code, "audio-silent-tail");

const shortClip = auditProjectMedia(project([scene(2, {
  assets: [
    { id: "clip", type: "clip", r2Key: "clip", url: "/clip", metadata: { source: "user-upload", actualDurationSeconds: 1 } },
    { id: "audio", type: "audio", r2Key: "audio", url: "/audio", metadata: { actualDurationSeconds: 4 } }
  ]
})]));
assert.equal(shortClip.errors[0].code, "clip-freeze-tail");
assert.deepEqual(Array.from(shortClip.repairClipSceneNumbers), [2]);

const missingSource = auditProjectMedia(project([scene(3, {
  style: {
    theme: "dark",
    palette: ["#000"],
    mood: "calm",
    referenceAssets: [{ key: "source.mp4", contentType: "video/mp4", referenceUsage: "source-media" }]
  }
})]));
assert.equal(missingSource.errors[0].code, "source-not-bound");

console.log("Project media audit smoke checks passed.");
