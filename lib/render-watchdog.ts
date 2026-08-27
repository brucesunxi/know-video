import { renderSandboxName } from "@/lib/render-lifecycle";
import { enqueueRenderJobWatchdog, type RenderJobWatchdogMessage } from "@/lib/media-generation-queue";
import { expireRenderJobFromWatchdog, getRenderJob, updateRenderJob } from "@/lib/render-jobs";
import { stopRenderSandbox } from "@/lib/vercel-renderer";

export async function permanentlyFailRenderWatchdog(message: RenderJobWatchdogMessage) {
  const failed = await updateRenderJob({
    jobId: message.jobId,
    status: "failed",
    progress: 0,
    error: "渲染状态检查连续失败，系统已停止本次导出，可重新导出。"
  });
  if (failed) {
    await stopRenderSandbox(renderSandboxName(message.jobId)).catch((error) => {
      console.error(`[render-watchdog] Unable to stop terminally failed render sandbox ${message.jobId}:`, error);
    });
  }
  return Boolean(failed);
}

export async function processRenderJobWatchdog(message: RenderJobWatchdogMessage) {
  const expired = await expireRenderJobFromWatchdog(message);
  if (expired) {
    await stopRenderSandbox(renderSandboxName(message.jobId)).catch((error) => {
      console.error(`[render-watchdog] Unable to stop expired render sandbox ${message.jobId}:`, error);
    });
    return true;
  }

  const renderJob = await getRenderJob(message.jobId);
  if (renderJob?.status === "queued" || renderJob?.status === "running") {
    await enqueueRenderJobWatchdog({
      ...message,
      watchdogPass: (message.watchdogPass ?? 0) + 1
    });
  }
  return false;
}
