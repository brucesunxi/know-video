import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/production-settings.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports });
const { DEFAULT_PRODUCTION_SETTINGS, productionDurationInFrames, productionSettingsFromScenes } = module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

assert.deepEqual(plain(productionSettingsFromScenes([])), plain(DEFAULT_PRODUCTION_SETTINGS));
assert.deepEqual(plain(productionSettingsFromScenes([{ style: { production: {
  captionsEnabled: false,
  captionStyle: "highlight",
  playbackRate: 1.25,
  musicVolume: 0.9,
  logoPosition: "bottom-left",
  logoSize: 99
} } }])), {
  captionsEnabled: false,
  captionStyle: "highlight",
  playbackRate: 1.25,
  musicVolume: 0.5,
  musicDucking: "balanced",
  logoPosition: "bottom-left",
  logoSize: 24
});
assert.deepEqual(plain(productionSettingsFromScenes([{ style: { production: {
  captionStyle: "broken",
  playbackRate: 7,
  musicVolume: "broken",
  logoPosition: "center",
  logoSize: "broken"
} } }])), plain(DEFAULT_PRODUCTION_SETTINGS));
assert.equal(productionDurationInFrames({ durationSeconds: 30, scenes: [{ style: { production: { playbackRate: 1.5 } } }] }, 30), 600);

console.log("Production settings smoke checks passed.");
