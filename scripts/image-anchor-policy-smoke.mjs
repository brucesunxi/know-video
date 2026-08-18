import assert from "node:assert/strict";
import fs from "node:fs";

const imageAssets = fs.readFileSync(new URL("../lib/image-assets.ts", import.meta.url), "utf8");
const continuity = fs.readFileSync(new URL("../lib/image-continuity.ts", import.meta.url), "utf8");

assert.match(imageAssets, /loadProjectStyleAnchorReference/);
assert.match(imageAssets, /metadata\?\.source === "generated-image"/);
assert.match(imageAssets, /loadImageReference\(anchorAsset, "style-anchor"\)/);
assert.match(continuity, /export type ImageReferenceRole = "current" \| "style-anchor"/);
assert.match(continuity, /STYLE-ONLY anchor from this project/);
assert.match(continuity, /Do not copy its subject, objects, layout, camera angle, pose, or background/);
assert.match(continuity, /Minecraft|minecraft/);
assert.match(continuity, /COURSE \/ GAME SEMANTIC FIDELITY/);
assert.match(continuity, /Do not repeat the same layout/);
assert.match(continuity, /build the distinct scene content required below/);
assert.match(continuity, /SCENE DIFFERENTIATION/);

console.log("Image anchor policy smoke checks passed.");
