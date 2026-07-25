import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/composition-revision.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require: () => ({}) });
const { compositionRevision } = module.exports;

function version(images) {
  return {
    durationSeconds: 30,
    scenes: images.map((url, index) => ({
      id: `scene-${index + 1}`,
      sceneNumber: index + 1,
      durationSeconds: 6,
      title: `Scene ${index + 1}`,
      voiceover: `Narration ${index + 1}`,
      motionPrompt: "slow push in",
      style: { palette: ["#000", "#fff"] },
      assets: url ? [{
        id: `image-${index + 1}`,
        type: "image",
        url,
        r2Key: `scene-${index + 1}.png`,
        metadata: { width: 1920, height: 1080 }
      }] : []
    }))
  };
}

const empty = version(["", "", "", "", ""]);
const complete = version(["one.png", "two.png", "three.png", "four.png", "five.png"]);
assert.notEqual(compositionRevision(empty), compositionRevision(complete));

const changedSceneFive = structuredClone(complete);
changedSceneFive.scenes[4].assets[0].url = "five-v2.png";
assert.notEqual(compositionRevision(complete), compositionRevision(changedSceneFive));

const changedDuration = structuredClone(complete);
changedDuration.scenes[1].durationSeconds = 8;
assert.notEqual(compositionRevision(complete), compositionRevision(changedDuration));

const changedOrder = structuredClone(complete);
changedOrder.scenes.reverse();
assert.notEqual(compositionRevision(complete), compositionRevision(changedOrder));

assert.equal(compositionRevision(complete), compositionRevision(structuredClone(complete)));

console.log("Composition revision smoke checks passed.");
