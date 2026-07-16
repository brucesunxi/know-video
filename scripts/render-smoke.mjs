import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const output = process.argv[2] || "/tmp/know-video-smoke.mp4";
const frameStart = Number.parseInt(process.argv[3] || "0", 10);
const frameEnd = Number.parseInt(process.argv[4] || "59", 10);
if (!Number.isInteger(frameStart) || !Number.isInteger(frameEnd) || frameStart < 0 || frameEnd < frameStart) {
  throw new Error("Frame range must be two positive integers: start end");
}

const pngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mNkYPj/n4GBgYGJAQoAHgQCAZ7R+8sAAAAASUVORK5CYII=";

function wavDataUrl(durationSeconds = 2, frequency = 440) {
  const sampleRate = 24_000;
  const sampleCount = Math.round(sampleRate * durationSeconds);
  const bytes = Buffer.alloc(44 + sampleCount * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + sampleCount * 2, 4);
  bytes.write("WAVE", 8);
  bytes.write("fmt ", 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const fade = Math.min(1, index / 600, (sampleCount - index) / 600);
    bytes.writeInt16LE(Math.round(Math.sin((index / sampleRate) * frequency * Math.PI * 2) * 4_000 * fade), 44 + index * 2);
  }
  return `data:audio/wav;base64,${bytes.toString("base64")}`;
}

const smokeProject = {
  id: "render-smoke",
  title: "Know Video Render Verification",
  engine: "Animation Engine",
  credits: 0,
  plan: "Free",
  currentVersion: {
    id: "render-smoke-v1",
    label: "smoke",
    status: "ready",
    createdAt: new Date(0).toISOString(),
    durationSeconds: 4,
    scenes: [
      {
        id: "smoke-scene-1",
        sceneNumber: 1,
        title: "这是一个用于验证长中文标题不会溢出的真实渲染场景",
        voiceover: "画面、字幕和音频必须同时进入最终视频文件，才能算真正通过导出验证。",
        visualPrompt: "Render verification",
        motionPrompt: "Camera pushes in slowly",
        durationSeconds: 4,
        style: { theme: "cinematic", palette: ["#08111f", "#22c7b8"], mood: "precise" },
        assets: [
          { id: "smoke-image", type: "image", url: pngDataUrl, r2Key: "smoke/image.png" },
          { id: "smoke-audio", type: "audio", url: wavDataUrl(), r2Key: "smoke/audio.wav" }
        ]
      }
    ]
  }
};

const serveUrl = await bundle({
  entryPoint: resolve("video/remotion-root.tsx"),
  webpackOverride: (config) => ({
    ...config,
    resolve: { ...config.resolve, alias: { ...(config.resolve?.alias || {}), "@": resolve(".") } }
  })
});
const inputProps = { project: smokeProject };
const composition = await selectComposition({ serveUrl, id: "KnowVideoFilm", inputProps });
await renderMedia({
  composition,
  serveUrl,
  codec: "h264",
  audioCodec: "aac",
  outputLocation: output,
  frameRange: [frameStart, frameEnd],
  inputProps,
  ...(process.env.REMOTION_BROWSER_EXECUTABLE
    ? { browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE }
    : {})
});
console.log(`RENDER_SMOKE_OK ${output} ${(await stat(output)).size} bytes`);
