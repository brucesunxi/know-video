import assert from "node:assert/strict";
import { assessRenderedOutputMetadata, inspectRenderedOutput } from "../worker/render-output-quality.mjs";

const valid = {
  container: "mp4",
  duration: 30,
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: "h264",
  videoTrackCount: 1,
  audioTrackCount: 1,
  size: 4_000_000,
  expectedDuration: 30,
  expectedWidth: 1920,
  expectedHeight: 1080,
  expectedFps: 30
};

assert.equal(assessRenderedOutputMetadata(valid).audioTrackCount, 1);
assert.throws(() => assessRenderedOutputMetadata({ ...valid, audioTrackCount: 0 }), /audio track/);
assert.throws(() => assessRenderedOutputMetadata({ ...valid, videoCodec: "h265" }), /H\.264/);
assert.throws(() => assessRenderedOutputMetadata({ ...valid, width: 1280, height: 720 }), /dimensions/);
assert.throws(() => assessRenderedOutputMetadata({ ...valid, duration: 27.5 }), /duration/);
assert.throws(() => assessRenderedOutputMetadata({ ...valid, fps: 24 }), /frame rate/);
await assert.rejects(() => inspectRenderedOutput(Buffer.alloc(1_000), {
  duration: 30,
  width: 1920,
  height: 1080,
  fps: 30
}), /unexpectedly small/);

console.log("Rendered output quality smoke passed.");
