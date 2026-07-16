import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { getOptionalEnv } from "@/lib/env";
import { matchesRenderSandbox, renderOutputKey } from "@/lib/render-lifecycle";
import { getRenderJob, updateRenderJob } from "@/lib/render-jobs";
import { deleteUnreferencedStorageObjects } from "@/lib/storage-cleanup";
import { stopRenderSandbox } from "@/lib/vercel-renderer";

const payloadSchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum(["running", "ready", "failed"]),
  progress: z.number().int().min(0).max(100),
  outputR2Key: z.string().optional(),
  error: z.string().optional(),
  sandboxName: z.string().optional()
}).superRefine((payload, context) => {
  if (payload.status === "ready" && !payload.outputR2Key) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Ready callback requires outputR2Key" });
  }
  if (payload.status === "failed" && !payload.error) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Failed callback requires error" });
  }
  if (!matchesRenderSandbox(payload.jobId, payload.sandboxName)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Sandbox name does not match job" });
  }
});

function authorized(request: Request) {
  const expected = getOptionalEnv("WORKER_SHARED_SECRET") || "";
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = payloadSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid render callback payload" }, { status: 400 });
  }
  const payload = parsed.data;
  const existing = await getRenderJob(payload.jobId);
  if (!existing) return NextResponse.json({ error: "Render job not found" }, { status: 404 });
  if (payload.outputR2Key && payload.outputR2Key !== renderOutputKey(existing)) {
    return NextResponse.json({ error: "Render output path does not match job" }, { status: 400 });
  }
  const renderJob = await updateRenderJob(payload);
  if (!renderJob && payload.outputR2Key) {
    await deleteUnreferencedStorageObjects([payload.outputR2Key]).catch((error) => {
      console.error("[render-callback] Unable to clean stale render output:", error);
    });
    await updateRenderJob({
      jobId: payload.jobId,
      status: "cancelled",
      progress: 0,
      error: "视频版本已经发生变化，旧版本导出已取消。"
    }).catch((error) => {
      console.error("[render-callback] Unable to cancel stale render job:", error);
    });
  }
  if (["ready", "failed"].includes(payload.status) && payload.sandboxName) {
    after(() => stopRenderSandbox(payload.sandboxName!).catch((error) => {
      console.error("Unable to stop render sandbox", error);
    }));
  }
  return renderJob
    ? NextResponse.json({ renderJob })
    : NextResponse.json({ error: "Render callback is stale or the job is no longer active" }, { status: 409 });
}
