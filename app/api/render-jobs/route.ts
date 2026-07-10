import { NextResponse } from "next/server";
import { z } from "zod";

const requestSchema = z.object({
  projectId: z.string(),
  versionId: z.string(),
  affectedScenes: z.array(z.number()).default([])
});

export async function POST(request: Request) {
  const body = requestSchema.parse(await request.json());

  return NextResponse.json({
    renderJob: {
      id: crypto.randomUUID(),
      projectId: body.projectId,
      versionId: body.versionId,
      status: "queued",
      progress: 0,
      affectedScenes: body.affectedScenes
    }
  });
}
