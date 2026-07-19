import { NextResponse } from "next/server";
import { z } from "zod";
import { createStoryboardProject } from "@/lib/ai-video";
import { matchesDeclaredAssetType, maxUploadBytes, uploadedAssetType } from "@/lib/asset-policy";
import { analyzeCloudflareImage, hasCloudflareAI, transcribeCloudflareAudio } from "@/lib/cloudflare-ai";
import {
  attachGenerationReferenceAssets,
  createGenerationReferenceAsset,
  generationReferenceContext
} from "@/lib/generation-reference-assets";
import {
  claimGenerationRequest,
  completeGenerationRequest,
  failGenerationRequest,
  generationRequestFingerprint
} from "@/lib/generation-requests";
import { persistGeneratedProject } from "@/lib/project-mutations";
import { getProjectSnapshot, listProjects } from "@/lib/project-store";
import { getFromR2, headR2Object, readR2Prefix } from "@/lib/r2";
import { deleteUnreferencedStorageObjects } from "@/lib/storage-cleanup";

const referenceAssetSchema = z.object({
  key: z.string().min(1).max(800),
  name: z.string().min(1).max(240),
  size: z.number().int().positive().max(500_000_000),
  contentType: z.string().min(1).max(120),
  derivedFrom: z.string().min(1).max(240).optional(),
  referenceRole: z.literal("video-poster").optional(),
  actualDurationSeconds: z.number().positive().max(21_600).optional()
});

const requestSchema = z.object({
  prompt: z.string().trim().min(4).max(4000),
  requestId: z.string().uuid().optional(),
  options: z.object({
    duration: z.enum(["15", "30", "45", "60"]),
    sceneCount: z.enum(["auto", "3", "5", "6"]),
    language: z.enum(["中文", "英文"]),
    style: z.enum(["电影质感", "极简高级", "明快有活力", "温暖自然"]),
    motion: z.enum(["camera", "key-scenes"]),
    videoTier: z.enum(["economy", "balanced"])
  }).optional(),
  referenceAssets: z.array(referenceAssetSchema).max(12).default([])
}).superRefine((value, context) => {
  if (value.referenceAssets.length > 0 && !value.requestId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "上传参考素材时必须提供生成任务标识。" });
  }
  const uploadedVideoNames = new Set(value.referenceAssets
    .filter((reference) => reference.contentType.startsWith("video/"))
    .map((reference) => reference.name));
  value.referenceAssets.forEach((reference, index) => {
    if (reference.actualDurationSeconds && !reference.contentType.startsWith("video/")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "只有视频附件可以声明视频时长。",
        path: ["referenceAssets", index, "actualDurationSeconds"]
      });
    }
    if (reference.referenceRole === "video-poster") {
      if (!reference.contentType.startsWith("image/") || !reference.derivedFrom || !uploadedVideoNames.has(reference.derivedFrom)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "视频关键帧必须对应同一任务中上传的视频。",
          path: ["referenceAssets", index]
        });
      }
    } else if (reference.derivedFrom) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "只有视频关键帧可以声明来源视频。",
        path: ["referenceAssets", index]
      });
    }
  });
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
  let uploadedReferenceKeys: string[] = [];
  try {
    const body = requestSchema.parse(await request.json());
    requestId = body.requestId;
    uploadedReferenceKeys = requestId
      ? body.referenceAssets
        .map((reference) => reference.key)
        .filter((key) => key.startsWith(`uploads/generation/${requestId}/`))
      : [];
    if (requestId) {
      const claim = await claimGenerationRequest({
        id: requestId,
        fingerprint: generationRequestFingerprint(body.prompt, body.options, body.referenceAssets)
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
    const validatedReferences = await Promise.all(body.referenceAssets.map(async (reference) => {
      if (!requestId || !reference.key.startsWith(`uploads/generation/${requestId}/`)) {
        throw new Error("参考素材上传路径无效。");
      }
      const type = uploadedAssetType(reference.contentType);
      if (!type || reference.size > maxUploadBytes(reference.contentType)) {
        throw new Error("参考素材格式或大小无效。");
      }
      const stored = await headR2Object(reference.key);
      if (stored.contentLength !== reference.size || stored.contentType !== reference.contentType) {
        throw new Error("参考素材的大小或格式校验失败。");
      }
      const prefix = await readR2Prefix(reference.key);
      if (!matchesDeclaredAssetType(prefix, reference.contentType)) {
        throw new Error("参考素材内容与声明格式不一致。");
      }
      return reference;
    }));
    const visualReferences = validatedReferences.filter((reference) => reference.contentType.startsWith("image/"));
    const prioritizedVisualReferences = [
      ...visualReferences.filter((reference) => reference.referenceRole === "video-poster"),
      ...visualReferences.filter((reference) => reference.referenceRole !== "video-poster")
    ].slice(0, 3);
    const analyzableReferences = [
      ...prioritizedVisualReferences,
      ...validatedReferences
        .filter((reference) => reference.contentType.startsWith("audio/") && reference.size <= 15_000_000)
        .slice(0, 2)
    ];
    const analyses = Object.fromEntries((await Promise.all(analyzableReferences.map(async (reference) => {
      if (!hasCloudflareAI()) return undefined;
      try {
        const stored = await getFromR2(reference.key);
        if (!stored.body) return undefined;
        const bytes = Buffer.from(await stored.body.transformToByteArray());
        if (reference.contentType.startsWith("image/")) {
          const analyzed = await analyzeCloudflareImage(bytes);
          return [reference.key, { text: analyzed.description, kind: "visual" as const }] as const;
        }
        const transcribed = await transcribeCloudflareAudio(bytes);
        return [reference.key, { text: transcribed.transcript, kind: "transcript" as const }] as const;
      } catch (error) {
        console.warn(`[projects] Unable to analyze reference asset ${reference.key}:`, error);
        return undefined;
      }
    }))).filter(Boolean) as Array<readonly [string, { text: string; kind: "visual" | "transcript" }]>);
    const enrichedReferences = validatedReferences.map((reference) => ({
      ...reference,
      analysis: analyses[reference.key]?.text,
      analysisKind: analyses[reference.key]?.kind
    }));
    const referenceAssets = enrichedReferences.map(createGenerationReferenceAsset);
    const referenceContext = generationReferenceContext(enrichedReferences);
    const generated = await createStoryboardProject(body.prompt, undefined, body.options, referenceContext);
    const project = attachGenerationReferenceAssets(generated.project, referenceAssets);
    const { engine } = generated;
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
    if (uploadedReferenceKeys.length > 0) {
      await deleteUnreferencedStorageObjects(uploadedReferenceKeys).catch((cleanupError) => {
        console.error("[projects] Unable to clean unused generation references:", cleanupError);
      });
    }
    if (requestId) await failGenerationRequest(requestId).catch(() => undefined);
    console.error("[projects] Unable to create video project:", error);
    return NextResponse.json(
      { error: "视频项目没有完整保存，请稍后重试。本次失败不会留下半成品项目。" },
      { status: 502 }
    );
  }
}
