import { NextResponse } from "next/server";
import { z } from "zod";
import { persistAssistantMessage } from "@/lib/project-mutations";

const requestSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().min(1).max(200),
  versionId: z.string().min(1).max(200),
  content: z.string().trim().min(1).max(2000)
});

export async function POST(request: Request) {
  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof z.ZodError ? "制作记录格式无效。" : "无法读取制作记录。" },
      { status: 400 }
    );
  }

  try {
    const message = await persistAssistantMessage(body);
    return NextResponse.json({ message });
  } catch (error) {
    const message = error instanceof Error ? error.message : "制作记录保存失败。";
    return NextResponse.json(
      { error: message },
      { status: /版本已经发生变化/.test(message) ? 409 : 502 }
    );
  }
}
