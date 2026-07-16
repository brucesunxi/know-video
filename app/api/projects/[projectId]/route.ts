import { NextResponse } from "next/server";
import { getProjectSnapshot } from "@/lib/project-store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await context.params;
  const snapshot = await getProjectSnapshot(projectId);
  if (!snapshot) {
    return NextResponse.json({ error: "项目不存在或已经被删除。" }, { status: 404 });
  }
  return NextResponse.json(snapshot);
}
