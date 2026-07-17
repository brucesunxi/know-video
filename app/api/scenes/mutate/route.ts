import { NextResponse } from "next/server";
import { z } from "zod";
import { loadCurrentProjectForEdit } from "@/lib/project-mutations";
import { persistSceneStructureMutation } from "@/lib/scene-structure-mutations";

const common = {
  projectId: z.string().min(1).max(200),
  versionId: z.string().min(1).max(200),
  sceneNumber: z.number().int().positive()
};
const schema = z.discriminatedUnion("operation", [
  z.object({ ...common, operation: z.literal("set-duration"), durationSeconds: z.number().int().min(2).max(20) }),
  z.object({ ...common, operation: z.literal("move"), direction: z.enum(["earlier", "later"]) }),
  z.object({ ...common, operation: z.literal("duplicate") }),
  z.object({ ...common, operation: z.literal("delete") })
]);

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const project = await loadCurrentProjectForEdit(body.projectId, body.versionId);
    if (!project) return NextResponse.json({ error: "视频版本已经发生变化，请刷新后重试。" }, { status: 409 });
    return NextResponse.json(await persistSceneStructureMutation({ project, mutation: body }));
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "时间线调整参数无效。" }, { status: 400 });
    const message = error instanceof Error ? error.message : "时间线调整失败。";
    return NextResponse.json({ error: message }, { status: /版本已经发生变化/.test(message) ? 409 : 502 });
  }
}
