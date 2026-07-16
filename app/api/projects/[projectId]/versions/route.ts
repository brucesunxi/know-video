import { NextResponse } from "next/server";
import { listProjectVersions } from "@/lib/project-mutations";

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  const versions = await listProjectVersions(projectId);
  return NextResponse.json({ versions });
}
