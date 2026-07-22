import { NextResponse } from "next/server";
import { z } from "zod";
import { authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { deleteUnreferencedStorageObjects } from "@/lib/storage-cleanup";

const schema = z.object({
  requestId: z.string().uuid(),
  keys: z.array(z.string().min(1).max(800)).max(12)
});

export async function POST(request: Request) {
  try {
    await requireCurrentUser();
    const body = schema.parse(await request.json());
    const prefix = `uploads/generation/${body.requestId}/`;
    if (body.keys.some((key) => !key.startsWith(prefix))) {
      return NextResponse.json({ error: "参考素材清理路径无效。" }, { status: 403 });
    }
    await deleteUnreferencedStorageObjects(body.keys);
    return NextResponse.json({ cleaned: body.keys.length });
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    const message = error instanceof z.ZodError ? "参考素材清理请求无效。" : "参考素材清理失败。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
