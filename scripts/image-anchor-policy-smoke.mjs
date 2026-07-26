import assert from "node:assert/strict";
import fs from "node:fs";

const imageAssets = fs.readFileSync(new URL("../lib/image-assets.ts", import.meta.url), "utf8");
const continuity = fs.readFileSync(new URL("../lib/image-continuity.ts", import.meta.url), "utf8");

assert.doesNotMatch(imageAssets, /projectAnchor/);
assert.doesNotMatch(imageAssets, /role: "anchor"/);
assert.doesNotMatch(imageAssets, /Reference image [\s\S]*project's visual anchor/);
assert.doesNotMatch(imageAssets, /shouldUseProjectAnchorReference/);
assert.doesNotMatch(continuity, /export function shouldUseProjectAnchorReference/);
assert.doesNotMatch(continuity, /selectVisualAnchorScene/);
assert.doesNotMatch(continuity, /project's visual anchor/);
assert.match(continuity, /export type ImageReferenceRole = "current"/);
assert.match(continuity, /Minecraft|minecraft/);
assert.match(continuity, /COURSE \/ GAME SEMANTIC FIDELITY/);
assert.match(continuity, /Do not repeat the same layout/);
assert.match(continuity, /Do not use it as a template for any other scene/);
assert.match(continuity, /SCENE DIFFERENTIATION/);

console.log("Image anchor policy smoke checks passed.");
