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
const serveUrl = await bundle({
  entryPoint: resolve("video/remotion-root.tsx"),
  webpackOverride: (config) => ({
    ...config,
    resolve: { ...config.resolve, alias: { ...(config.resolve?.alias || {}), "@": resolve(".") } }
  })
});
const composition = await selectComposition({ serveUrl, id: "KnowVideoFilm" });
await renderMedia({
  composition,
  serveUrl,
  codec: "h264",
  audioCodec: "aac",
  outputLocation: output,
  frameRange: [frameStart, frameEnd],
  ...(process.env.REMOTION_BROWSER_EXECUTABLE
    ? { browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE }
    : {})
});
console.log(`RENDER_SMOKE_OK ${output} ${(await stat(output)).size} bytes`);
