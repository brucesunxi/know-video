import { NextResponse } from "next/server";
import { z } from "zod";
import { restoreProjectVersion } from "@/lib/project-mutations";

const schema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid()
});

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const params = await context.params;
    const body = await request.json();
    const { projectId, versionId } = schema.parse({ projectId: params.projectId, versionId: body.versionId });
    const result = await restoreProjectVersion({ projectId, targetVersionId: versionId });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "版本恢复请求无效。" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "版本恢复失败，请稍后重试。";
    const status = /没有找到|不属于/.test(message) ? 404 : /当前版本|已经发生变化/.test(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
