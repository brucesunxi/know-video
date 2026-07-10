import { NextResponse } from "next/server";
import { z } from "zod";
import { applyPersistedEditPlan } from "@/lib/project-mutations";
import type { EditPlan, Project } from "@/lib/types";

const requestSchema = z.object({
  project: z.unknown(),
  editPlan: z.unknown()
});

export const maxDuration = 120;

export async function POST(request: Request) {
  const body = requestSchema.parse(await request.json());
  const result = await applyPersistedEditPlan({
    project: body.project as Project,
    editPlan: body.editPlan as EditPlan
  });

  return NextResponse.json(result);
}
