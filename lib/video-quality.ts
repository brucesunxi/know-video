import { parseMedia } from "@remotion/media-parser";

const MIN_VIDEO_BYTES = 50_000;
const MIN_WIDTH = 640;
const MIN_HEIGHT = 360;

export class GeneratedVideoQualityError extends Error {}

export type GeneratedVideoMetadata = {
  container: "mp4";
  duration: number;
  requestedDuration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  size: number;
};

export function assessGeneratedVideoMetadata(input: {
  container: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  codec: string | null;
  size: number;
  requestedDuration: number;
}): GeneratedVideoMetadata {
  if (input.size < MIN_VIDEO_BYTES) {
    throw new GeneratedVideoQualityError("生成的视频文件过小。");
  }
  if (input.container !== "mp4") {
    throw new GeneratedVideoQualityError("视频服务返回了不支持的封装格式。");
  }
  if (!input.codec || input.codec !== "h264") {
    throw new GeneratedVideoQualityError("生成视频不是兼容性良好的 H.264 格式。");
  }
  if (!input.width || !input.height || input.width < MIN_WIDTH || input.height < MIN_HEIGHT) {
    throw new GeneratedVideoQualityError("生成视频的画面分辨率过低。");
  }
  const aspectRatio = input.width / input.height;
  if (aspectRatio < 1.65 || aspectRatio > 1.9) {
    throw new GeneratedVideoQualityError("生成视频不是可用的 16:9 画幅。");
  }
  if (!input.fps || input.fps < 20 || input.fps > 60) {
    throw new GeneratedVideoQualityError("生成视频的帧率不可用。");
  }
  if (!input.duration || !Number.isFinite(input.duration)) {
    throw new GeneratedVideoQualityError("无法读取生成视频的时长。");
  }
  const minimumDuration = Math.max(2.5, input.requestedDuration * 0.8);
  if (input.duration < minimumDuration) {
    throw new GeneratedVideoQualityError("生成视频的实际时长明显短于场景要求。");
  }

  return {
    container: "mp4",
    duration: Number(input.duration.toFixed(3)),
    requestedDuration: input.requestedDuration,
    width: input.width,
    height: input.height,
    fps: Number(input.fps.toFixed(3)),
    codec: input.codec,
    size: input.size
  };
}

export async function inspectGeneratedVideo(body: Buffer, requestedDuration: number) {
  if (body.length < MIN_VIDEO_BYTES) {
    throw new GeneratedVideoQualityError("生成的视频文件过小。");
  }

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
    throw new GeneratedVideoQualityError("视频服务返回了无法解析的 MP4 文件。", { cause: error });
  }
  const videoTracks = parsed.tracks.filter((track) => track.type === "video");
  if (videoTracks.length !== 1) {
    throw new GeneratedVideoQualityError("生成视频缺少有效的单一画面轨道。");
  }

  return assessGeneratedVideoMetadata({
    container: parsed.container,
    duration: parsed.durationInSeconds,
    width: parsed.dimensions?.width ?? null,
    height: parsed.dimensions?.height ?? null,
    fps: parsed.fps,
    codec: parsed.videoCodec,
    size: body.length,
    requestedDuration
  });
}
