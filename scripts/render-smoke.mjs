import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const output = process.argv[2] || "/tmp/know-video-smoke.mp4";
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
  frameRange: [0, 59],
  browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE
    || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
});
console.log(`RENDER_SMOKE_OK ${output} ${(await stat(output)).size} bytes`);

