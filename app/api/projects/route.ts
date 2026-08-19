import { after, NextResponse } from "next/server";
import { z } from "zod";
import { authRequiredResponse, requireCurrentUser } from "@/lib/auth";
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
  attachGenerationRequestProject,
  completeGenerationRequest,
  failGenerationRequest,
  generationRequestFingerprint,
  listIncompleteGenerationRequests
} from "@/lib/generation-requests";
import { enqueueProjectMediaScene } from "@/lib/media-generation-queue";
import { persistGeneratedProject } from "@/lib/project-mutations";
import { getProjectSnapshot, listProjects } from "@/lib/project-store";
import { getFromR2, headR2Object, readR2Prefix } from "@/lib/r2";
import { deleteUnreferencedStorageObjects } from "@/lib/storage-cleanup";
import {
  InsufficientCreditsError,
  billingIdempotencyKey,
  recordUsageEvent,
  releaseCreditReservation,
  reserveAdditionalCredits,
  reserveCredits
} from "@/lib/billing/usage";
import { estimateBilling } from "@/lib/billing/estimate";
import { hasDatabaseUrl } from "@/lib/db";
import { NARRATION_VOICE_IDS } from "@/lib/types";
import { contentPromptForGeneration } from "@/lib/generation-prompt";
import { sceneRequiresPremiumImage } from "@/lib/image-continuity";

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
    visualStyleId: z.string().trim().min(1).max(80).optional(),
    visualStyleLabel: z.string().trim().min(1).max(80).optional(),
    visualStylePrompt: z.string().trim().min(1).max(800).optional(),
    motion: z.enum(["camera", "stock"]),
    narrationVoice: z.enum(NARRATION_VOICE_IDS).optional()
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
  try {
    const user = await requireCurrentUser();
    const [projects, generationRequests] = await Promise.all([
      listProjects(user.id),
      listIncompleteGenerationRequests(user.id)
    ]);
    return NextResponse.json({ projects, generationRequests });
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    throw error;
  }
}

function publicEngine(engine: string) {
  return engine === "heuristic" ? "heuristic" : "ai";
}

function publicGenerationError(error: unknown) {
  if (error instanceof Error) {
    if (/relation .* does not exist|column .* does not exist|neondberror|sqlstate|42p01|42703/i.test(error.message)) {
      return "生成服务初始化没有完成，请重试。";
    }
    if (/timeout|timed out|connection|fetch failed|econn|etimedout|network/i.test(error.message)) {
      return "脚本服务连接超时，请稍后重试。";
    }
    if (/json|schema|structured/i.test(error.message)) {
      return "脚本服务返回结构不完整，已停止保存半成品，请重试。";
    }
    return error.message.slice(0, 240) || "视频脚本和分镜生成没有完成，请重试。";
  }
  return "视频脚本和分镜生成没有完成，请重试。";
}

type ProjectGenerationInput = z.infer<typeof requestSchema>;

function projectReservationKey(requestId: string) {
  return `project-generation:${requestId}`;
}

function plannedSceneCount(body: ProjectGenerationInput) {
  if (body.options?.sceneCount && body.options.sceneCount !== "auto") return Number(body.options.sceneCount);
  const duration = Number(body.options?.duration ?? 30);
  if (duration <= 15) return 3;
  if (duration <= 45) return 5;
  return 6;
}

function projectEstimateItems(body: ProjectGenerationInput) {
  const duration = Number(body.options?.duration ?? 30);
  const sceneCount = plannedSceneCount(body);
  const imageReferences = body.referenceAssets.filter((asset) => asset.contentType.startsWith("image/")).length;
  const audioReferences = body.referenceAssets.filter((asset) => asset.contentType.startsWith("audio/") && asset.size <= 15_000_000).length;
  const visionQuantity = Math.min(3, imageReferences) + Math.min(2, audioReferences);
  return [
    { resourceType: "storyboard_plan" as const, quantity: 1 },
    ...(visionQuantity > 0 ? [{ resourceType: "vision_analysis" as const, quantity: visionQuantity }] : []),
    { resourceType: "image_standard" as const, quantity: sceneCount },
    // Background narration settles scene by scene, where each segment has a
    // five-credit minimum. Reserve the larger of target duration or per-scene minimums.
    { resourceType: "speech" as const, quantity: Math.max(Math.ceil(duration * 1.2), sceneCount * 5) }
  ];
}

function uploadedReferenceKeys(body: ProjectGenerationInput) {
  if (!body.requestId) return [];
  return body.referenceAssets
    .map((reference) => reference.key)
    .filter((key) => key.startsWith(`uploads/generation/${body.requestId}/`));
}

async function generateAndPersistProject(body: ProjectGenerationInput, userId: string) {
  const requestId = body.requestId;
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
      engine,
      userId
    });
    if (requestId) {
      const initiallyReserved = estimateBilling(projectEstimateItems(body)).maximumCredits;
      const actualSpeechCredits = persisted.project.currentVersion.scenes.reduce(
        (sum, scene) => sum + Math.max(5, Math.ceil(scene.durationSeconds)),
        0
      );
      const actualBaseCredits = estimateBilling([
        { resourceType: "storyboard_plan", quantity: 1 },
        ...(Object.keys(analyses).length > 0
          ? [{ resourceType: "vision_analysis" as const, quantity: Object.keys(analyses).length }]
          : []),
        { resourceType: "image_standard", quantity: persisted.project.currentVersion.scenes.length }
      ]).maximumCredits + actualSpeechCredits;
      if (actualBaseCredits > initiallyReserved) {
        await reserveAdditionalCredits({
          userId,
          reservationKey: projectReservationKey(requestId),
          adjustmentKey: `${requestId}:actual-storyboard-shape`,
          credits: actualBaseCredits - initiallyReserved,
          metadata: {
            actualSceneCount: persisted.project.currentVersion.scenes.length,
            actualSpeechCredits
          }
        });
      }
      const standardImage = estimateBilling([{ resourceType: "image_standard", quantity: 1 }]);
      const premiumImage = estimateBilling([{ resourceType: "image_premium", quantity: 1 }]);
      for (const scene of persisted.project.currentVersion.scenes.filter(sceneRequiresPremiumImage)) {
        await reserveAdditionalCredits({
          userId,
          reservationKey: projectReservationKey(requestId),
          adjustmentKey: `${requestId}:scene:${scene.sceneNumber}:premium-upgrade`,
          credits: premiumImage.maximumCredits - standardImage.maximumCredits,
          estimatedCostUsd: premiumImage.estimatedProviderCostUsd - standardImage.estimatedProviderCostUsd,
          metadata: { sceneNumber: scene.sceneNumber, automaticPremiumUpgrade: true }
        });
      }
    }
    await recordUsageEvent({
      userId,
      projectId: persisted.project.id,
      versionId: persisted.project.currentVersion.id,
      reservationKey: requestId ? projectReservationKey(requestId) : undefined,
      resourceType: "storyboard_plan",
      quantity: 1,
      idempotencyKey: requestId
        ? `storyboard_plan:${requestId}`
        : billingIdempotencyKey("storyboard_plan", [persisted.project.id, persisted.project.currentVersion.id]),
      status: "settled",
      metadata: {
        engine,
        sceneCount: persisted.project.currentVersion.scenes.length,
        promptCharacters: body.prompt.length
      }
    });
    if (Object.keys(analyses).length > 0) {
      await recordUsageEvent({
        userId,
        projectId: persisted.project.id,
        versionId: persisted.project.currentVersion.id,
        reservationKey: requestId ? projectReservationKey(requestId) : undefined,
        resourceType: "vision_analysis",
        quantity: Object.keys(analyses).length,
        idempotencyKey: requestId
          ? `vision_analysis:${requestId}`
          : billingIdempotencyKey("vision_analysis", [persisted.project.id, ...Object.keys(analyses).sort()]),
        status: "settled",
        metadata: { analyzedReferenceKeys: Object.keys(analyses).sort() }
      });
    }
    if (requestId) {
      await attachGenerationRequestProject({ id: requestId, projectId: persisted.project.id, engine });
      const firstSceneNumber = persisted.project.currentVersion.scenes
        .map((scene) => scene.sceneNumber)
        .sort((left, right) => left - right)[0];
      if (firstSceneNumber) {
        await enqueueProjectMediaScene({
          requestId,
          userId,
          projectId: persisted.project.id,
          versionId: persisted.project.currentVersion.id,
          sceneNumber: firstSceneNumber,
          engine,
          billingReservationKey: projectReservationKey(requestId),
          options: body.options
        });
      } else {
        await completeGenerationRequest({ id: requestId, projectId: persisted.project.id, engine });
        await releaseCreditReservation({
          userId,
          reservationKey: projectReservationKey(requestId),
          reason: "project_completed_without_scenes"
        });
      }
    }
    return { ...persisted, engine: publicEngine(engine) };
}

async function failBackgroundGeneration(body: ProjectGenerationInput, error: unknown, userId?: string) {
  const keys = uploadedReferenceKeys(body);
  if (keys.length > 0) {
    await deleteUnreferencedStorageObjects(keys).catch((cleanupError) => {
      console.error("[projects] Unable to clean unused generation references:", cleanupError);
    });
  }
  if (body.requestId) {
    await failGenerationRequest(body.requestId, publicGenerationError(error)).catch(() => undefined);
    if (userId) {
      await releaseCreditReservation({
        userId,
        reservationKey: projectReservationKey(body.requestId),
        reason: "project_generation_failed",
        metadata: { error: publicGenerationError(error) }
      }).catch(() => undefined);
    }
  }
  console.error("[projects] Unable to create video project:", error);
}

async function runBackgroundGeneration(body: ProjectGenerationInput, userId: string) {
  try {
    await generateAndPersistProject(body, userId);
  } catch (error) {
    await failBackgroundGeneration(body, error, userId);
  }
}

export async function POST(request: Request) {
  let body: ProjectGenerationInput | undefined;
  let billingUserId: string | undefined;
  try {
    const user = await requireCurrentUser();
    billingUserId = user.id;
    body = requestSchema.parse(await request.json());
    body = { ...body, prompt: contentPromptForGeneration(body.prompt) };
    if (body.prompt.length < 4) {
      return NextResponse.json({ error: "请先描述视频要表达的具体内容，风格选择不能代替内容需求。" }, { status: 400 });
    }
    const requestId = body.requestId;
    if (requestId) {
      const claim = await claimGenerationRequest({
        id: requestId,
        userId: user.id,
        prompt: body.prompt,
        options: body.options,
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
        const snapshot = await getProjectSnapshot(claim.record.projectId, user.id);
        if (!snapshot) throw new Error("生成任务已经完成，但项目读取失败。");
        return NextResponse.json({
          project: snapshot.project,
          messages: snapshot.messages,
          engine: publicEngine(claim.record.engine || "ai"),
          recovered: true
        });
      }
      if (hasDatabaseUrl()) {
        const reservation = await reserveCredits({
          userId: user.id,
          reservationKey: projectReservationKey(requestId),
          items: projectEstimateItems(body),
          metadata: {
            requestId,
            plannedSceneCount: plannedSceneCount(body),
            targetDurationSeconds: Number(body.options?.duration ?? 30)
          },
          expiresInMinutes: 180
        });
        after(() => runBackgroundGeneration(body!, user.id));
        return NextResponse.json({ status: "pending", requestId, billingEstimate: reservation.estimate }, { status: 202 });
      }
    }
    return NextResponse.json(await generateAndPersistProject(body, user.id));
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "请用 4 到 4000 个字符描述要制作的视频，并检查时长、场景数、语言、风格和动态方式。" },
        { status: 400 }
      );
    }
    if (error instanceof InsufficientCreditsError) {
      if (body) await failBackgroundGeneration(body, error, billingUserId);
      return NextResponse.json({
        error: error.message,
        code: "INSUFFICIENT_CREDITS",
        availableCredits: error.availableCredits,
        requiredCredits: error.requiredCredits
      }, { status: 402 });
    }
    if (body) await failBackgroundGeneration(body, error, billingUserId);
    return NextResponse.json(
      { error: publicGenerationError(error) },
      { status: 502 }
    );
  }
}
