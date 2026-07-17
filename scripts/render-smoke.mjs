import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const output = process.argv[2] || "/tmp/know-video-smoke.mp4";
const frameStart = Number.parseInt(process.argv[3] || "0", 10);
const frameEnd = Number.parseInt(process.argv[4] || "179", 10);
const clipPath = process.argv[5];
if (!Number.isInteger(frameStart) || !Number.isInteger(frameEnd) || frameStart < 0 || frameEnd < frameStart) {
  throw new Error("Frame range must be two positive integers: start end");
}

const pngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mNkYPj/n4GBgYGJAQoAHgQCAZ7R+8sAAAAASUVORK5CYII=";
let clipUrl;
let clipServer;
if (clipPath) {
  const clipBody = await readFile(clipPath);
  clipServer = createServer((request, response) => {
    if (request.url !== "/clip.mp4") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "accept-ranges": "bytes",
      "content-length": clipBody.length,
      "content-type": "video/mp4"
    });
    response.end(clipBody);
  });
  await new Promise((resolveListen) => clipServer.listen(0, "127.0.0.1", resolveListen));
  const address = clipServer.address();
  if (!address || typeof address === "string") throw new Error("Unable to start clip fixture server");
  clipUrl = `http://127.0.0.1:${address.port}/clip.mp4`;
}

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
    durationSeconds: 6,
    scenes: [
      {
        id: "smoke-scene-1",
        sceneNumber: 1,
        title: "这是一个用于验证长中文标题不会溢出的真实渲染场景",
        voiceover: "画面和字幕进入时间线。",
        visualPrompt: "Render verification",
        motionPrompt: "Camera pans slowly to the right",
        durationSeconds: 2,
        style: {
          theme: "cinematic",
          palette: ["#08111f", "#22c7b8"],
          mood: "precise",
          production: {
            captionsEnabled: true,
            captionStyle: "highlight",
            playbackRate: 1.25,
            musicVolume: 0.05,
            logoPosition: "top-right",
            logoSize: 10
          }
        },
        assets: [
          ...(clipUrl ? [{ id: "smoke-clip", type: "clip", url: clipUrl, r2Key: "smoke/clip.mp4", metadata: { duration: 2 } }] : []),
          { id: "smoke-image", type: "image", url: pngDataUrl, r2Key: "smoke/image.png" },
          { id: "smoke-audio", type: "audio", url: wavDataUrl(), r2Key: "smoke/audio.wav" },
          { id: "smoke-logo", type: "logo", url: pngDataUrl, r2Key: "smoke/logo.png" },
          { id: "smoke-music", type: "music", url: wavDataUrl(1, 220), r2Key: "smoke/music.wav" }
        ]
      },
      {
        id: "smoke-scene-2",
        sceneNumber: 2,
        title: "镜头运动与旁白衔接",
        voiceover: "每段旁白自然进入并退出。",
        visualPrompt: "Audio transition verification",
        motionPrompt: "Camera pushes in slowly with foreground parallax",
        durationSeconds: 2,
        style: { theme: "cinematic", palette: ["#10223d", "#f5c46b"], mood: "flowing" },
        assets: [
          { id: "smoke-image-2", type: "image", url: pngDataUrl, r2Key: "smoke/image-2.png" },
          { id: "smoke-audio-2", type: "audio", url: wavDataUrl(2, 520), r2Key: "smoke/audio-2.wav" }
        ]
      },
      {
        id: "smoke-scene-3",
        sceneNumber: 3,
        title: "预览与最终导出保持一致",
        voiceover: "最终视频包含完整画面和声音。",
        visualPrompt: "Final render verification",
        motionPrompt: "A clean wipe reveals the final composition",
        durationSeconds: 2,
        style: { theme: "cinematic", palette: ["#15152a", "#8fd8ff"], mood: "resolved" },
        assets: [
          { id: "smoke-image-3", type: "image", url: pngDataUrl, r2Key: "smoke/image-3.png" },
          { id: "smoke-audio-3", type: "audio", url: wavDataUrl(2, 620), r2Key: "smoke/audio-3.wav" }
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
  frameRange: [frameStart, Math.min(frameEnd, composition.durationInFrames - 1)],
  inputProps,
  ...(process.env.REMOTION_BROWSER_EXECUTABLE
    ? { browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE }
    : {})
});
if (clipServer) await new Promise((resolveClose, rejectClose) => clipServer.close((error) => error ? rejectClose(error) : resolveClose()));
console.log(`RENDER_SMOKE_OK ${output} ${(await stat(output)).size} bytes`);
