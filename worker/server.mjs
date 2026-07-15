import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const port = Number(process.env.PORT || 8080);
const secret = process.env.WORKER_SHARED_SECRET;
const required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "WORKER_SHARED_SECRET"];
for (const name of required) if (!process.env[name]) throw new Error(`Missing ${name}`);

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
});

let bundlePromise;
function getBundle() {
  bundlePromise ??= bundle({
    entryPoint: resolve("video/remotion-root.tsx"),
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...config.resolve,
        alias: { ...(config.resolve?.alias || {}), "@": resolve(".") }
      }
    })
  });
  return bundlePromise;
}

function withAbsoluteAssetUrls(project, baseUrl) {
  return {
    ...project,
    currentVersion: {
      ...project.currentVersion,
      scenes: project.currentVersion.scenes.map((scene) => ({
        ...scene,
        assets: scene.assets.map((asset) => ({
          ...asset,
          url: asset.url.startsWith("/") ? new URL(asset.url, baseUrl).toString() : asset.url
        }))
      }))
    }
  };
}

async function callback(url, payload) {
  if (!url) return;
  await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify(payload)
  }).catch((error) => console.error("Callback failed", error));
}

async function render(input) {
  const directory = await mkdtemp(join(tmpdir(), "know-video-"));
  const output = join(directory, "output.mp4");
  const project = withAbsoluteAssetUrls(input.project, input.assetBaseUrl);
  try {
    await callback(input.callbackUrl, { jobId: input.jobId, status: "running", progress: 12 });
    const serveUrl = await getBundle();
    const composition = await selectComposition({ serveUrl, id: "KnowVideoFilm", inputProps: { project } });
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      audioCodec: "aac",
      outputLocation: output,
      inputProps: { project },
      browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE,
      chromiumOptions: { disableWebSecurity: true },
      onProgress: ({ progress }) => {
        const percent = Math.min(94, 15 + Math.round(progress * 79));
        if (percent % 10 === 0) callback(input.callbackUrl, { jobId: input.jobId, status: "running", progress: percent });
      }
    });
    const key = `renders/${project.id}/${project.currentVersion.id}/${input.jobId}.mp4`;
    await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, Body: await readFile(output), ContentType: "video/mp4" }));
    await callback(input.callbackUrl, { jobId: input.jobId, status: "ready", progress: 100, outputR2Key: key });
    return { outputR2Key: key };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Render failed";
    await callback(input.callbackUrl, { jobId: input.jobId, status: "failed", progress: 0, error: message });
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

createServer(async (request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.method === "GET" && request.url === "/health") {
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (request.method !== "POST" || request.url !== "/render") {
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "Not found" }));
    return;
  }
  if (request.headers.authorization !== `Bearer ${secret}`) {
    response.statusCode = 401;
    response.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const result = await render(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    response.end(JSON.stringify(result));
  } catch (error) {
    response.statusCode = 500;
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Render failed" }));
  }
}).listen(port, () => console.log(`Know Video renderer listening on ${port}`));
