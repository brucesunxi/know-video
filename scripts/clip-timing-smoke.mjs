import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/clip-timing.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require: () => ({}) });
const { clipDurationInFrames, resolvedClipPlaybackRate } = module.exports;

const generated = {
  type: "clip",
  metadata: { source: "generated-video", duration: 6.4 }
};
const generatedRate = resolvedClipPlaybackRate({
  asset: generated,
  sceneDurationSeconds: 8,
  productionPlaybackRate: 1
});
assert.equal(generatedRate, 0.8);
assert.equal(clipDurationInFrames(generated, 30, generatedRate), 240);

assert.equal(resolvedClipPlaybackRate({
  asset: { ...generated, metadata: { ...generated.metadata, duration: 7.2 } },
  sceneDurationSeconds: 8,
  productionPlaybackRate: 1.25
}), 1.125);

assert.equal(resolvedClipPlaybackRate({
  asset: { type: "clip", metadata: { source: "user-upload", actualDurationSeconds: 6.4 } },
  sceneDurationSeconds: 8,
  productionPlaybackRate: 1
}), 0.8);
assert.equal(resolvedClipPlaybackRate({
  asset: { type: "clip", metadata: { source: "user-upload", actualDurationSeconds: 3 } },
  sceneDurationSeconds: 8,
  productionPlaybackRate: 1
}), 0.375);
assert.equal(resolvedClipPlaybackRate({
  asset: { type: "clip", metadata: { source: "user-upload", actualDurationSeconds: 1 } },
  sceneDurationSeconds: 8,
  productionPlaybackRate: 1
}), 1);

const shortGenerated = { type: "clip", metadata: { source: "generated-video", duration: 2 } };
const shortGeneratedRate = resolvedClipPlaybackRate({
  asset: shortGenerated,
  sceneDurationSeconds: 8,
  productionPlaybackRate: 1
});
assert.equal(shortGeneratedRate, 0.25);
assert.equal(clipDurationInFrames(shortGenerated, 30, shortGeneratedRate), 240);

console.log("Clip timing smoke checks passed.");
