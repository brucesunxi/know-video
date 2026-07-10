import { NextResponse } from "next/server";
import { z } from "zod";
import { demoProject } from "@/lib/mock-data";
import { buildMockEditPlan } from "@/lib/edit-planner";

const requestSchema = z.object({
  request: z.string().min(1),
  versionId: z.string().optional()
});

export async function POST(request: Request) {
  const json = await request.json();
  const body = requestSchema.parse(json);

  const editPlan = buildMockEditPlan({
    request: body.request,
    version: demoProject.currentVersion,
    editNumber: 5
  });

  return NextResponse.json({ editPlan });
}
