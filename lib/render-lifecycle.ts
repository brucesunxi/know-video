import type { RenderJob } from "@/lib/types";

export function renderSandboxName(jobId: string) {
  return `know-video-job-${jobId}`;
}

export function matchesRenderSandbox(jobId: string, sandboxName?: string) {
  return !sandboxName || sandboxName === renderSandboxName(jobId);
}

export function publicRenderError(status: RenderJob["status"]) {
  if (status === "cancelled") return "场景素材已经更新，请重新导出最新版本。";
  if (status === "failed") {
    return "视频合成没有完成，请稍后重试。若持续失败，请重新生成缺失素材后再导出。";
  }
  return undefined;
}
