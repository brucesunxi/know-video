import { renderSandboxName } from "@/lib/render-lifecycle";
import type { RenderJobWatchdogMessage } from "@/lib/media-generation-queue";
import { expireRenderJobFromWatchdog } from "@/lib/render-jobs";
import { stopRenderSandbox } from "@/lib/vercel-renderer";

export async function processRenderJobWatchdog(message: RenderJobWatchdogMessage) {
  const expired = await expireRenderJobFromWatchdog(message);
  if (!expired) return false;
  await stopRenderSandbox(renderSandboxName(message.jobId)).catch((error) => {
    console.error(`[render-watchdog] Unable to stop expired render sandbox ${message.jobId}:`, error);
  });
  return true;
}
