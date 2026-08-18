import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../video/know-video-composition.tsx", import.meta.url), "utf8");

assert.match(source, /function visualLayerStyle/);
assert.match(source, /nativeVideo: boolean/);
assert.match(source, /nativeVideo\)\s*\{\s*return\s*\{/);
assert.match(source, /height:\s*"100%"/);
assert.match(source, /transform:\s*"none"/);
assert.match(source, /width:\s*"100%"/);
assert.match(source, /OffthreadVideo[\s\S]*nativeVideo: true/);
assert.match(source, /playbackRate=\{clipPlaybackRate\}/);
assert.match(source, /clipDurationInFrames/);
assert.match(source, /resolvedClipPlaybackRate/);
assert.match(source, /function LocalImageSequence/);
assert.match(source, /localMotionSequence\(scene, durationInFrames, VIDEO_FPS\)/);
assert.match(source, /beatTransitionOffset/);
assert.match(source, /previous && previousMotion && transitionProgress < 1/);
assert.match(source, /nativeVideo: false/);
assert.match(source, /sceneUsesAiMotionClip\(scene\)/);
assert.match(source, /freeStockVideoColorGrade\(scene\.style\)/);
assert.match(source, /height:\s*"112%"[\s\S]*translate3d\(\$\{motion\.x \+ transitionX\}%/);
assert.match(source, /Easing\.bezier\(0\.33, 0, 0\.2, 1\)/);
assert.match(source, /key=\{`narration-\$\{scene\.id\}`\}[\s\S]*<Audio[\s\S]*src=\{audio\}/);
assert.doesNotMatch(source.match(/function SceneFrame[\s\S]*?export function KnowVideoComposition/)?.[0] ?? "", /<Audio/);
assert.match(source, /premountFor=\{VIDEO_FPS \* 3\}/);

console.log("Composition video-layer smoke checks passed.");
