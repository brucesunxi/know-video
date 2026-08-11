import assert from "node:assert/strict";
import fs from "node:fs";

const player = fs.readFileSync(new URL("../app/video-player.tsx", import.meta.url), "utf8");
const composition = fs.readFileSync(new URL("../video/know-video-composition.tsx", import.meta.url), "utf8");
const preload = fs.readFileSync(new URL("../lib/preview-preload.ts", import.meta.url), "utf8");
const assetRoute = fs.readFileSync(new URL("../app/api/assets/[...key]/route.ts", import.meta.url), "utf8");

assert.match(player, /previewPreloadAssets\(project\)/);
assert.match(player, /prefetch\(asset\.url/);
assert.match(player, /credentials: "same-origin"/);
assert.match(player, /handle\.waitUntilDone\(\)\.catch/);
assert.match(player, /handle\.free\(\)/);
assert.match(player, /bufferStateDelayInMilliseconds=\{120\}/);
assert.match(composition, /<OffthreadVideo\s+muted\s+pauseWhenBuffering/);
assert.match(composition, /premountFor=\{VIDEO_FPS \* 4\}/);
assert.match(composition, /premountFor=\{VIDEO_FPS \* 3\}/);
assert.match(preload, /PREVIEW_PRELOAD_BUDGET_BYTES = 96 \* 1024 \* 1024/);
assert.match(preload, /const clip = assets\.find/);
assert.match(preload, /clip \?\? image/);
assert.match(assetRoute, /"accept-ranges": "bytes"/);
assert.match(assetRoute, /"cache-control": "public, max-age=31536000, immutable"/);
assert.doesNotMatch(assetRoute, /no-store/);

console.log("Preview playback smoke checks passed.");
