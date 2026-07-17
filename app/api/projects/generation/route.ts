import { NextResponse } from "next/server";
import { z } from "zod";
import { getGenerationRequest } from "@/lib/generation-requests";
import { getProjectSnapshot } from "@/lib/project-store";

const requestIdSchema = z.string().uuid();

export async function GET(request: Request) {
  const requestId = new URL(request.url).searchParams.get("requestId");
  const parsed = requestIdSchema.safeParse(requestId);
  if (!parsed.success) {
    return NextResponse.json({ error: "生成任务标识无效。" }, { status: 400 });
  }
  const generation = await getGenerationRequest(parsed.data);
  if (!generation) {
    return NextResponse.json({ error: "没有找到生成任务。" }, { status: 404 });
  }
  if (generation.status === "ready" && generation.projectId) {
    const snapshot = await getProjectSnapshot(generation.projectId);
    if (!snapshot) {
      return NextResponse.json({ error: "生成任务已经完成，但项目读取失败。" }, { status: 502 });
    }
    return NextResponse.json({
      status: "ready",
      project: snapshot.project,
      messages: snapshot.messages,
      engine: generation.engine === "heuristic" ? "heuristic" : "ai",
      recovered: true
    });
  }
  if (generation.status === "failed") {
    return NextResponse.json({
      status: "failed",
      error: generation.error || "视频脚本和分镜生成没有完成，请重试。"
    });
  }
  return NextResponse.json({ status: "pending" }, { status: 202 });
}
