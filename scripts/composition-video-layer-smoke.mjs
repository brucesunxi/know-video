import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../video/know-video-composition.tsx", import.meta.url), "utf8");

assert.match(source, /function visualLayerStyle/);
assert.match(source, /nativeVideo: boolean/);
assert.match(source, /nativeVideo\)\s*\{\s*return\s*\{/);
assert.match(source, /height:\s*"100%"/);
assert.match(source, /transform:\s*"none"/);
assert.match(source, /width:\s*"100%"/);
assert.match(source, /OffthreadVideo[\s\S]*style=\{visualLayerStyle\(\{ motion, nativeVideo: true \}\)\}/);
assert.match(source, /playbackRate=\{clipPlaybackRate\}/);
assert.match(source, /clipDurationInFrames/);
assert.match(source, /resolvedClipPlaybackRate/);
assert.match(source, /Img[\s\S]*style=\{visualLayerStyle\(\{ motion, nativeVideo: false \}\)\}/);
assert.match(source, /height:\s*"106%"[\s\S]*transform:\s*`scale\(\$\{motion\.scale\}\)`/);

console.log("Composition video-layer smoke checks passed.");
