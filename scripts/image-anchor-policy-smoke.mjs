import assert from "node:assert/strict";
import fs from "node:fs";

const imageAssets = fs.readFileSync(new URL("../lib/image-assets.ts", import.meta.url), "utf8");
const continuity = fs.readFileSync(new URL("../lib/image-continuity.ts", import.meta.url), "utf8");

assert.match(imageAssets, /shouldUseProjectAnchorReference/);
assert.match(imageAssets, /shouldUseProjectAnchorReference\(scene, project\)/);
assert.match(continuity, /export function shouldUseProjectAnchorReference/);
assert.match(continuity, /Minecraft|minecraft/);
assert.match(continuity, /COURSE \/ GAME SEMANTIC FIDELITY/);
assert.match(continuity, /Do not repeat the same layout/);
assert.match(continuity, /Do not copy its layout/);
assert.match(continuity, /SCENE DIFFERENTIATION/);

console.log("Image anchor policy smoke checks passed.");
