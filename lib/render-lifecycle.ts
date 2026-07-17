import type { RenderJob } from "@/lib/types";

export const MIN_RENDER_OUTPUT_BYTES = 50_000;

export function renderSandboxName(jobId: string) {
  return `know-video-job-${jobId}`;
}

export function matchesRenderSandbox(jobId: string, sandboxName?: string) {
  return !sandboxName || sandboxName === renderSandboxName(jobId);
}

export function renderOutputKey(input: Pick<RenderJob, "id" | "projectId" | "versionId">) {
  return `renders/${input.projectId}/${input.versionId}/${input.id}.mp4`;
}

export function publicRenderError(status: RenderJob["status"], reason?: string) {
  if (status === "cancelled") {
    return reason?.includes("用户")
      ? "用户已取消本次导出。"
      : "场景素材已经更新，请重新导出最新版本。";
  }
  if (status === "failed") {
    return "视频合成没有完成，请稍后重试。若持续失败，请重新生成缺失素材后再导出。";
  }
  return undefined;
}

export function versionStatusAfterRenderJob(status: RenderJob["status"]) {
  if (status === "running") return "rendering";
  if (status === "ready") return "ready";
  if (status === "failed" || status === "cancelled") return "draft";
  return undefined;
}

export function renderOutputMetadataIssue(input: {
  contentLength?: number;
  contentType?: string;
}) {
  if (!input.contentLength || input.contentLength < MIN_RENDER_OUTPUT_BYTES) {
    return "渲染文件大小异常。";
  }
  if (!input.contentType?.toLowerCase().startsWith("video/mp4")) {
    return "渲染文件格式不是 MP4。";
  }
  return undefined;
}

export function isRenderCallbackReplay(
  existing: Pick<RenderJob, "status" | "progress" | "outputR2Key">,
  incoming: Pick<RenderJob, "status" | "progress" | "outputR2Key">
) {
  if (existing.status !== incoming.status) return false;
  if (incoming.status === "ready") {
    return Boolean(incoming.outputR2Key && existing.outputR2Key === incoming.outputR2Key);
  }
  if (incoming.status === "failed") return true;
  if (incoming.status === "running") return existing.progress >= incoming.progress;
  return false;
}
