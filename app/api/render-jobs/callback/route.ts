import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getOptionalEnv } from "@/lib/env";
import { updateRenderJob } from "@/lib/render-jobs";

const payloadSchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum(["running", "ready", "failed"]),
  progress: z.number().int().min(0).max(100),
  outputR2Key: z.string().optional(),
  error: z.string().optional()
});

function authorized(request: Request) {
  const expected = getOptionalEnv("WORKER_SHARED_SECRET") || "";
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = payloadSchema.parse(await request.json());
  const renderJob = await updateRenderJob(payload);
  return renderJob
    ? NextResponse.json({ renderJob })
    : NextResponse.json({ error: "Render job not found" }, { status: 404 });
}

