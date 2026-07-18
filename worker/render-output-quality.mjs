import { File as NodeFile } from "node:buffer";
import { parseMedia } from "@remotion/media-parser";

if (typeof globalThis.File === "undefined") globalThis.File = NodeFile;

const MIN_RENDER_BYTES = 50_000;

export function assessRenderedOutputMetadata(input) {
  if (input.size < MIN_RENDER_BYTES) throw new Error("Rendered MP4 is unexpectedly small");
  if (input.container !== "mp4") throw new Error("Rendered output is not an MP4 container");
  if (input.videoCodec !== "h264") throw new Error("Rendered MP4 does not use the required H.264 video codec");
  if (input.videoTrackCount !== 1) throw new Error("Rendered MP4 must contain exactly one video track");
  if (input.audioTrackCount < 1) throw new Error("Rendered MP4 does not contain an audio track");
  if (input.width !== input.expectedWidth || input.height !== input.expectedHeight) {
    throw new Error(`Rendered MP4 dimensions are ${input.width ?? 0}x${input.height ?? 0}, expected ${input.expectedWidth}x${input.expectedHeight}`);
  }
  if (!input.fps || Math.abs(input.fps - input.expectedFps) > 0.15) {
    throw new Error(`Rendered MP4 frame rate is ${input.fps ?? 0}, expected ${input.expectedFps}`);
  }
  if (!input.duration || !Number.isFinite(input.duration)) throw new Error("Rendered MP4 duration could not be read");
  const durationTolerance = Math.max(0.22, input.expectedDuration * 0.015);
  if (Math.abs(input.duration - input.expectedDuration) > durationTolerance) {
    throw new Error(`Rendered MP4 duration is ${input.duration.toFixed(3)}s, expected ${input.expectedDuration.toFixed(3)}s`);
  }
  return {
    duration: input.duration,
    width: input.width,
    height: input.height,
    fps: input.fps,
    videoCodec: input.videoCodec,
    videoTrackCount: input.videoTrackCount,
    audioTrackCount: input.audioTrackCount,
    size: input.size
  };
}

export async function inspectRenderedOutput(body, expected) {
  if (body.length < MIN_RENDER_BYTES) throw new Error(`Rendered MP4 is unexpectedly small (${body.length} bytes)`);
  let parsed;
  try {
    parsed = await parseMedia({
      src: new Blob([new Uint8Array(body)]),
      fields: {
        container: true,
        dimensions: true,
        durationInSeconds: true,
        fps: true,
        tracks: true,
        videoCodec: true
      },
      acknowledgeRemotionLicense: true
    });
  } catch (error) {
    throw new Error("Rendered MP4 could not be decoded", { cause: error });
  }
  return assessRenderedOutputMetadata({
    container: parsed.container,
    duration: parsed.durationInSeconds,
    width: parsed.dimensions?.width ?? null,
    height: parsed.dimensions?.height ?? null,
    fps: parsed.fps,
    videoCodec: parsed.videoCodec,
    videoTrackCount: parsed.tracks.filter((track) => track.type === "video").length,
    audioTrackCount: parsed.tracks.filter((track) => track.type === "audio").length,
    size: body.length,
    expectedDuration: expected.duration,
    expectedWidth: expected.width,
    expectedHeight: expected.height,
    expectedFps: expected.fps
  });
}
