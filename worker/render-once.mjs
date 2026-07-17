import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { postRenderCallback } from "./render-callback.mjs";
import { inspectRenderedOutput } from "./render-output-quality.mjs";

const required = [
  "RENDER_INPUT_PATH",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "WORKER_SHARED_SECRET"
];
for (const name of required) if (!process.env[name]) throw new Error(`Missing ${name}`);

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

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

async function render(input) {
  const directory = await mkdtemp(join(tmpdir(), "know-video-"));
  const output = join(directory, "output.mp4");
  const project = withAbsoluteAssetUrls(input.project, input.assetBaseUrl);
  let lastProgress = 0;
  let progressCallbacks = Promise.resolve();
  let uploadedKey;

  try {
    await postRenderCallback(input, { jobId: input.jobId, status: "running", progress: 10 });
    const serveUrl = await bundle({
      entryPoint: resolve("video/remotion-root.tsx"),
      webpackOverride: (config) => ({
        ...config,
        resolve: {
          ...config.resolve,
          alias: { ...(config.resolve?.alias || {}), "@": resolve(".") }
        }
      })
    });
    await postRenderCallback(input, { jobId: input.jobId, status: "running", progress: 18 });
    const composition = await selectComposition({
      serveUrl,
      id: "KnowVideoFilm",
      inputProps: { project }
    });
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      audioCodec: "aac",
      outputLocation: output,
      inputProps: { project },
      chromiumOptions: { disableWebSecurity: true },
      onProgress: ({ progress }) => {
        const percent = Math.min(94, 20 + Math.floor(progress * 74));
        if (percent >= lastProgress + 5) {
          lastProgress = percent;
          progressCallbacks = progressCallbacks.then(() => postRenderCallback(input, {
            jobId: input.jobId,
            status: "running",
            progress: percent
          }))
            .catch((error) => console.error("Progress callback failed", error));
        }
      }
    });

    await progressCallbacks;
    await postRenderCallback(input, { jobId: input.jobId, status: "running", progress: 96 });
    const key = `renders/${project.id}/${project.currentVersion.id}/${input.jobId}.mp4`;
    const outputBody = await readFile(output);
    const outputMetadata = await inspectRenderedOutput(outputBody, {
      duration: composition.durationInFrames / composition.fps,
      width: composition.width,
      height: composition.height,
      fps: composition.fps
    });
    await r2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: outputBody,
      ContentType: "video/mp4"
    }));
    uploadedKey = key;
    const uploaded = await r2.send(new HeadObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key
    }));
    if (uploaded.ContentLength !== outputBody.length || !uploaded.ContentType?.toLowerCase().startsWith("video/mp4")) {
      throw new Error(`Uploaded MP4 verification failed (${uploaded.ContentLength ?? 0} bytes, ${uploaded.ContentType ?? "unknown type"})`);
    }
    await postRenderCallback(input, {
      jobId: input.jobId,
      status: "ready",
      progress: 100,
      outputR2Key: key,
      metadata: {
        quality: "passed",
        ...outputMetadata,
        expectedDuration: composition.durationInFrames / composition.fps,
        inspectedAt: new Date().toISOString()
      }
    });
    uploadedKey = undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Render failed";
    if (uploadedKey) {
      await r2.send(new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: uploadedKey
      })).catch((cleanupError) => console.error("Unable to clean failed render upload", cleanupError));
    }
    await postRenderCallback(input, {
      jobId: input.jobId,
      status: "failed",
      progress: 0,
      error: message.slice(0, 2000)
    }).catch((callbackError) => console.error("Failure callback failed", callbackError));
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(process.env.RENDER_INPUT_PATH, { force: true });
  }
}

const input = JSON.parse(await readFile(process.env.RENDER_INPUT_PATH, "utf8"));
await render(input);
