import { NextResponse } from "next/server";
import { z } from "zod";
import { restoreProjectVersion } from "@/lib/project-mutations";

const schema = z.object({ versionId: z.string().uuid() });

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  const { versionId } = schema.parse(await request.json());
  const result = await restoreProjectVersion({ projectId, targetVersionId: versionId });
  return NextResponse.json(result);
}
