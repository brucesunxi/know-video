import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { getOptionalEnv } from "@/lib/env";
import { updateRenderJob } from "@/lib/render-jobs";
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
  const renderJob = await updateRenderJob(payload);
  if (["ready", "failed"].includes(payload.status) && payload.sandboxName) {
    after(() => stopRenderSandbox(payload.sandboxName!).catch((error) => {
      console.error("Unable to stop render sandbox", error);
    }));
  }
  return renderJob
    ? NextResponse.json({ renderJob })
    : NextResponse.json({ error: "Render job not found" }, { status: 404 });
}
