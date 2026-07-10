import { NextResponse } from "next/server";
import { z } from "zod";
import { demoProject } from "@/lib/mock-data";
import { createEditPlan } from "@/lib/ai-video";
import { loadVersion, persistEditPlan } from "@/lib/project-mutations";
import type { ProjectVersion } from "@/lib/types";

const requestSchema = z.object({
  request: z.string().min(1),
  projectId: z.string().optional(),
  versionId: z.string().optional()
});

export async function POST(request: Request) {
  const json = await request.json();
  const body = requestSchema.parse(json);
  const version = body.versionId
    ? await loadVersion(body.versionId)
    : undefined;
  const workingVersion: ProjectVersion = version ?? demoProject.currentVersion;
  const editNumber = Math.max(1, Math.round(Date.now() / 1000) % 10000);

  const { editPlan, engine } = await createEditPlan({
    request: body.request,
    version: workingVersion,
    editNumber
  });

  if (body.projectId && body.versionId) {
    const persisted = await persistEditPlan({
      projectId: body.projectId,
      request: body.request,
      versionId: body.versionId,
      editPlan,
      engine
    });
    return NextResponse.json({ ...persisted, engine });
  }

  return NextResponse.json({
    editPlan,
    engine,
    messages: [
      { id: crypto.randomUUID(), role: "user", type: "text", content: body.request },
      { id: crypto.randomUUID(), role: "assistant", type: "plan", content: editPlan.summary, editPlan }
    ]
  });
}
