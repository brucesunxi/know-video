import { NextResponse } from "next/server";
import { z } from "zod";
import { authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import {
  deleteFailedGenerationRequest,
  getGenerationRequest,
  getGenerationRequestBeforeExpiry,
  listCompletedPendingGenerationRequests,
  listIncompleteGenerationRequests
} from "@/lib/generation-requests";
import {
  reconcileCompletedGenerationRequest,
  reconcileCompletedGenerationRequests,
  recoverStalledGenerationRequest,
  recoverStalledGenerationRequests
} from "@/lib/generation-reconciliation";
import { getProjectSnapshot } from "@/lib/project-store";
import { sceneHasAudioAsset, sceneHasVisualAsset } from "@/lib/generation-resume";

const requestIdSchema = z.string().uuid();

export async function GET(request: Request) {
  let user;
  try {
    user = await requireCurrentUser();
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    throw error;
  }
  const requestId = new URL(request.url).searchParams.get("requestId");
  if (!requestId) {
    const candidates = await listCompletedPendingGenerationRequests(user.id);
    await reconcileCompletedGenerationRequests(candidates, user.id);
    const incomplete = await listIncompleteGenerationRequests(user.id);
    return NextResponse.json({
      generationRequests: await recoverStalledGenerationRequests(incomplete, user.id)
    });
  }
  const parsed = requestIdSchema.safeParse(requestId);
  if (!parsed.success) {
    return NextResponse.json({ error: "生成任务标识无效。" }, { status: 400 });
  }
  const beforeExpiry = await getGenerationRequestBeforeExpiry(parsed.data, user.id);
  const reconciled = beforeExpiry
    ? await reconcileCompletedGenerationRequest(beforeExpiry, user.id)
    : undefined;
  const recovered = reconciled
    ? await recoverStalledGenerationRequest(reconciled, user.id)
    : undefined;
  const generation = recovered?.status === "pending"
    ? await getGenerationRequest(parsed.data, user.id) ?? recovered
    : recovered ?? await getGenerationRequest(parsed.data, user.id);
  if (!generation) {
    return NextResponse.json({ error: "没有找到生成任务。" }, { status: 404 });
  }
  if (generation.status === "ready" && generation.projectId) {
    const snapshot = await getProjectSnapshot(generation.projectId, user.id);
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
  if (generation.projectId) {
    const snapshot = await getProjectSnapshot(generation.projectId, user.id);
    const scenes = snapshot?.project.currentVersion.scenes ?? [];
    return NextResponse.json({
      status: "pending",
      phase: "media",
      projectId: generation.projectId,
      progress: {
        scenes: scenes.length,
        visuals: scenes.filter(sceneHasVisualAsset).length,
        narrations: scenes.filter((scene) => scene.assets.some((asset) => asset.type === "audio" && asset.url)).length
      }
    }, { status: 202 });
  }
  return NextResponse.json({ status: "pending" }, { status: 202 });
}

export async function DELETE(request: Request) {
  let user;
  try {
    user = await requireCurrentUser();
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    throw error;
  }
  const parsed = requestIdSchema.safeParse(new URL(request.url).searchParams.get("requestId"));
  if (!parsed.success) {
    return NextResponse.json({ error: "生成任务标识无效。" }, { status: 400 });
  }
  const deleted = await deleteFailedGenerationRequest(parsed.data, user.id);
  if (!deleted) {
    return NextResponse.json({ error: "只能删除属于你的失败任务。" }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
