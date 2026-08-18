import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/local-motion.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, {
  module,
  exports: module.exports,
  require: (name) => {
    if (name === "@/lib/style-motion-policy") {
      return { styleAllowsFreeStockVideo: (style) => style.visualStyleId === "cinematic-realism" || !style.visualStyleId };
    }
    throw new Error(`Unexpected import: ${name}`);
  }
});
const { localMotionPlan, localMotionSequence, sceneUsesAiMotionClip } = module.exports;

const scene = (motionPrompt, overrides = {}) => ({
  id: "scene-1",
  sceneNumber: 1,
  motionPrompt,
  visualPrompt: "A teacher demonstrates a science experiment in a bright classroom.",
  durationSeconds: 6,
  style: {},
  assets: [{ type: "image", url: "/scene.png" }],
  ...overrides
});

assert.equal(localMotionPlan(scene("Camera slowly pushes in toward the teacher.")).preset, "push-in");
assert.equal(localMotionPlan(scene("Camera pulls back to reveal the full classroom.")).preset, "pull-out");
assert.equal(localMotionPlan(scene("Pan right across the experiment table.")).preset, "pan-right");
assert.equal(localMotionPlan(scene("镜头向上移动，展示高处的装置。")).preset, "tilt-up");

const shortPlan = localMotionPlan(scene("Pan left", { durationSeconds: 3 }));
const longPlan = localMotionPlan(scene("Pan left", { durationSeconds: 8 }));
assert.ok(Math.abs(shortPlan.xTo - shortPlan.xFrom) < Math.abs(longPlan.xTo - longPlan.xFrom));

const seeded = scene("A calm observational shot.", {
  style: { motion: { mode: "local", preset: "auto", intensity: "standard", seed: 7 } }
});
assert.deepEqual(localMotionPlan(seeded), localMotionPlan(seeded));
const sequence = localMotionSequence(seeded, 240, 30);
assert.ok(sequence.length >= 2);
assert.equal(sequence[0].startFrame, 0);
assert.equal(sequence.at(-1).endFrame, 240);
assert.equal(sequence[0].transitionFrames, 0);
assert.ok(sequence.slice(1).every((beat) => beat.transitionFrames > 0));
assert.ok(new Set(sequence.map((beat) => beat.plan.preset)).size >= 2);
assert.deepEqual(sequence, localMotionSequence(seeded, 240, 30));
const graphicScene = scene("A calm observational shot.", {
  style: { visualStyleId: "paper-collage", motion: { mode: "local", preset: "auto", intensity: "standard", seed: 7 } }
});
const graphicSequence = localMotionSequence(graphicScene, 240, 30);
assert.ok(graphicSequence.length >= sequence.length);
assert.ok(graphicSequence.every((beat) => beat.treatment === "graphic"));
assert.ok(graphicSequence.some((beat) => beat.transition === "paper-swap"));
assert.ok(
  Math.abs(localMotionPlan(graphicScene).scaleTo - localMotionPlan(graphicScene).scaleFrom)
    > Math.abs(localMotionPlan(seeded).scaleTo - localMotionPlan(seeded).scaleFrom)
);
assert.equal(sceneUsesAiMotionClip(seeded), false);
assert.equal(sceneUsesAiMotionClip(scene("Move", {
  style: { motion: { mode: "ai", preset: "auto", intensity: "standard", seed: 1 } },
  assets: [{ type: "clip", url: "/scene.mp4" }]
})), true);
assert.equal(sceneUsesAiMotionClip(scene("Move", {
  style: { visualStyleId: "comic-book", motion: { mode: "ai", preset: "auto", intensity: "standard", seed: 1 } },
  assets: [{ type: "clip", url: "/stock.mp4", metadata: { source: "free-stock-video" } }]
})), false);
assert.equal(sceneUsesAiMotionClip(scene("Move", {
  style: { visualStyleId: "cinematic-realism", motion: { mode: "ai", preset: "auto", intensity: "standard", seed: 1 } },
  assets: [{ type: "clip", url: "/stock.mp4", metadata: { source: "free-stock-video" } }]
})), true);
assert.equal(sceneUsesAiMotionClip(scene("Move", {
  style: { visualStyleId: "comic-book", motion: { mode: "ai", preset: "auto", intensity: "standard", seed: 1 } },
  assets: [{ type: "clip", url: "/uploaded.mp4", metadata: { source: "user-upload" } }]
})), true);

console.log("Local motion planner smoke checks passed.");
