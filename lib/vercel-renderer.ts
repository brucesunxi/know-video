import { Sandbox } from "@vercel/sandbox";
import { getOptionalEnv, getRequiredEnv } from "@/lib/env";
import type { Project } from "@/lib/types";

const SANDBOX_ROOT = "/vercel/sandbox";
const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RENDER_TIMEOUT_MS = 45 * 60 * 1000;

function rendererRevision() {
  return getOptionalEnv("VERCEL_GIT_COMMIT_SHA") || "main";
}

function baseSandboxName() {
  const revision = rendererRevision().replace(/[^a-zA-Z0-9-]/g, "").slice(0, 12) || "main";
  return `know-video-renderer-${revision}`;
}

async function ensureRendererBase() {
  const sandbox = await Sandbox.getOrCreate({
    name: baseSandboxName(),
    resume: false,
    runtime: "node24",
    timeout: 10 * 60 * 1000,
    resources: { vcpus: 4 },
    persistent: true,
    snapshotExpiration: SNAPSHOT_TTL_MS,
    keepLastSnapshots: { count: 1, expiration: SNAPSHOT_TTL_MS },
    source: {
      type: "git",
      url: getOptionalEnv("RENDER_SOURCE_REPOSITORY") || "https://github.com/brucesunxi/know-video.git",
      revision: rendererRevision(),
      depth: 1
    },
    tags: { service: "know-video", role: "renderer-base" },
    onCreate: async (created) => {
      const install = await created.runCommand("npm", ["ci"], {
        timeoutMs: 8 * 60 * 1000
      });
      if (install.exitCode !== 0) {
        throw new Error(`渲染环境安装失败：${(await install.stderr()).slice(-1200)}`);
      }
    }
  });

  if (!sandbox.currentSnapshotId) {
    await sandbox.snapshot({ expiration: SNAPSHOT_TTL_MS });
  }
  return sandbox.name;
}

export async function startSandboxRender(input: {
  jobId: string;
  project: Project;
  assetBaseUrl: string;
  callbackUrl: string;
}) {
  const sourceSandbox = await ensureRendererBase();
  const sandboxName = `know-video-job-${input.jobId}`;
  let sandbox: Sandbox | undefined;
  try {
    sandbox = await Sandbox.fork({
      sourceSandbox,
      name: sandboxName,
      timeout: RENDER_TIMEOUT_MS,
      resources: { vcpus: 4 },
      persistent: false,
      tags: { service: "know-video", role: "render-job" },
      env: {
        R2_ACCOUNT_ID: getRequiredEnv("R2_ACCOUNT_ID"),
        R2_ACCESS_KEY_ID: getRequiredEnv("R2_ACCESS_KEY_ID"),
        R2_SECRET_ACCESS_KEY: getRequiredEnv("R2_SECRET_ACCESS_KEY"),
        R2_BUCKET: getRequiredEnv("R2_BUCKET"),
        WORKER_SHARED_SECRET: getRequiredEnv("WORKER_SHARED_SECRET")
      }
    });

    const inputPath = `${SANDBOX_ROOT}/.render-jobs/${input.jobId}.json`;
    await sandbox.mkDir(`${SANDBOX_ROOT}/.render-jobs`);
    await sandbox.writeFiles([{
      path: inputPath,
      content: JSON.stringify({ ...input, sandboxName })
    }]);

    const command = await sandbox.runCommand({
      cmd: "node",
      args: ["worker/render-once.mjs"],
      cwd: SANDBOX_ROOT,
      detached: true,
      timeoutMs: RENDER_TIMEOUT_MS,
      env: { RENDER_INPUT_PATH: inputPath }
    });

    return { sandboxName, commandId: command.cmdId };
  } catch (error) {
    if (sandbox) await sandbox.delete().catch(() => undefined);
    throw error;
  }
}

export async function stopRenderSandbox(name: string) {
  if (!name.startsWith("know-video-job-")) return;
  const sandbox = await Sandbox.get({ name, resume: false });
  if (sandbox.status === "running") await sandbox.stop();
  await sandbox.delete();
}
