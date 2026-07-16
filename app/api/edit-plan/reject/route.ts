import { NextResponse } from "next/server";
import { z } from "zod";
import { rejectPersistedEditPlan } from "@/lib/project-mutations";

const schema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid(),
  editPlanId: z.string().uuid()
});

export async function POST(request: Request) {
  const body = schema.parse(await request.json());
  const message = await rejectPersistedEditPlan(body);
  return NextResponse.json({ message });
}
