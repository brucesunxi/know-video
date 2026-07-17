import assert from "node:assert/strict";
import { postRenderCallback } from "../worker/render-callback.mjs";

process.env.WORKER_SHARED_SECRET = "render-secret";
const input = {
  callbackUrl: "https://know-video.example/api/render-jobs/callback",
  sandboxName: "know-video-job-test"
};

let attempts = 0;
const waits = [];
await postRenderCallback(input, { jobId: "job", status: "ready", progress: 100, outputR2Key: "render.mp4" }, {
  fetchImpl: async (_url, options) => {
    attempts += 1;
    assert.equal(options.headers.authorization, "Bearer render-secret");
    const body = JSON.parse(options.body);
    assert.equal(body.sandboxName, input.sandboxName);
    if (attempts === 1) throw new Error("connection reset");
    if (attempts === 2) return { ok: false, status: 503, text: async () => "temporary" };
    return { ok: true, status: 200, text: async () => "" };
  },
  wait: async (milliseconds) => waits.push(milliseconds)
});
assert.equal(attempts, 3);
assert.deepEqual(waits, [750, 1500]);

attempts = 0;
await assert.rejects(
  postRenderCallback(input, { jobId: "job", status: "running", progress: 40 }, {
    fetchImpl: async () => {
      attempts += 1;
      return { ok: false, status: 503, text: async () => "still unavailable" };
    },
    wait: async () => undefined
  }),
  /503/
);
assert.equal(attempts, 3);

console.log("Render callback retry smoke checks passed.");
