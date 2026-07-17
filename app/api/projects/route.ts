import { NextResponse } from "next/server";
import { z } from "zod";
import { createStoryboardProject } from "@/lib/ai-video";
import {
  claimGenerationRequest,
  completeGenerationRequest,
  failGenerationRequest,
  generationRequestFingerprint
} from "@/lib/generation-requests";
import { persistGeneratedProject } from "@/lib/project-mutations";
import { getProjectSnapshot, listProjects } from "@/lib/project-store";

const requestSchema = z.object({
  prompt: z.string().trim().min(4).max(4000),
  requestId: z.string().uuid().optional(),
  options: z.object({
    duration: z.enum(["15", "30", "45", "60"]),
    sceneCount: z.enum(["auto", "3", "5", "6"]),
    language: z.enum(["中文", "英文"]),
    style: z.enum(["电影质感", "极简高级", "明快有活力", "温暖自然"]),
    motion: z.enum(["camera", "key-scenes"])
  }).optional()
});

export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({ projects: await listProjects() });
}

function publicEngine(engine: string) {
  return engine === "heuristic" ? "heuristic" : "ai";
}

export async function POST(request: Request) {
  let requestId: string | undefined;
  try {
    const body = requestSchema.parse(await request.json());
    requestId = body.requestId;
    if (requestId) {
      const claim = await claimGenerationRequest({
        id: requestId,
        fingerprint: generationRequestFingerprint(body.prompt, body.options)
      });
      if (claim.conflict) {
        return NextResponse.json({ error: "生成任务标识与当前需求不匹配，请重新提交。" }, { status: 409 });
      }
      if (!claim.claimed && claim.record?.status === "pending") {
        return NextResponse.json({ status: "pending", requestId }, { status: 202 });
      }
      if (!claim.claimed && claim.record?.status === "failed") {
        return NextResponse.json({ status: "failed", error: claim.record.error || "视频项目生成失败，请重试。" }, { status: 409 });
      }
      if (!claim.claimed && claim.record?.status === "ready" && claim.record.projectId) {
        const snapshot = await getProjectSnapshot(claim.record.projectId);
        if (!snapshot) throw new Error("生成任务已经完成，但项目读取失败。");
        return NextResponse.json({
          project: snapshot.project,
          messages: snapshot.messages,
          engine: publicEngine(claim.record.engine || "ai"),
          recovered: true
        });
      }
    }
    const { project, engine } = await createStoryboardProject(body.prompt, undefined, body.options);
    const persisted = await persistGeneratedProject({
      prompt: body.prompt,
      project,
      engine
    });
    if (requestId) {
      await completeGenerationRequest({ id: requestId, projectId: persisted.project.id, engine });
    }
    return NextResponse.json({ ...persisted, engine: publicEngine(engine) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "请用 4 到 4000 个字符描述要制作的视频，并检查时长、场景数、语言、风格和动态方式。" },
        { status: 400 }
      );
    }
    if (requestId) await failGenerationRequest(requestId).catch(() => undefined);
    console.error("[projects] Unable to create video project:", error);
    return NextResponse.json(
      { error: "视频项目没有完整保存，请稍后重试。本次失败不会留下半成品项目。" },
      { status: 502 }
    );
  }
}
