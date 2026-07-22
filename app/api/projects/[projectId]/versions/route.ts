import { NextResponse } from "next/server";
import { authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { listProjectVersions } from "@/lib/project-mutations";

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireCurrentUser();
    const { projectId } = await context.params;
    const versions = await listProjectVersions(projectId, user.id);
    return NextResponse.json({ versions });
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    throw error;
  }
}
