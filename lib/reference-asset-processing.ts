import { z } from "zod";
import { inspectAudio } from "@/lib/audio-quality";
import { matchesDeclaredAssetType, maxUploadBytes, uploadedAssetType } from "@/lib/asset-policy";
import { analyzeCloudflareImage, hasCloudflareAI, transcribeCloudflareAudio } from "@/lib/cloudflare-ai";
import { getFromR2, headR2Object, readR2Prefix } from "@/lib/r2";
import type { GenerationReferenceAsset } from "@/lib/types";

export const referenceAssetInputSchema = z.object({
  key: z.string().min(1).max(800),
  name: z.string().min(1).max(240),
  size: z.number().int().positive().max(500_000_000),
  contentType: z.string().min(1).max(120),
  derivedFrom: z.string().min(1).max(240).optional(),
  referenceRole: z.literal("video-poster").optional(),
  actualDurationSeconds: z.number().positive().max(21_600).optional()
});

export function validateReferenceRelationships(references: GenerationReferenceAsset[], context: z.RefinementCtx) {
  const uploadedVideoNames = new Set(references
    .filter((reference) => reference.contentType.startsWith("video/"))
    .map((reference) => reference.name));
  references.forEach((reference, index) => {
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
}

export async function validateAndAnalyzeReferenceAssets(params: {
  requestId: string;
  references: GenerationReferenceAsset[];
}): Promise<GenerationReferenceAsset[]> {
  const prefix = `uploads/generation/${params.requestId}/`;
  const validated = await Promise.all(params.references.map(async (reference) => {
    if (!reference.key.startsWith(prefix)) throw new Error("参考素材上传路径无效。");
    if (!uploadedAssetType(reference.contentType) || reference.size > maxUploadBytes(reference.contentType)) {
      throw new Error("参考素材格式或大小无效。");
    }
    const stored = await headR2Object(reference.key);
    if (stored.contentLength !== reference.size || stored.contentType !== reference.contentType) {
      throw new Error("参考素材的大小或格式校验失败。");
    }
    if (!matchesDeclaredAssetType(await readR2Prefix(reference.key), reference.contentType)) {
      throw new Error("参考素材内容与声明格式不一致。");
    }
    return reference;
  }));

  const visual = validated.filter((reference) => reference.contentType.startsWith("image/"));
  const analyzable = [
    ...visual.filter((reference) => reference.referenceRole === "video-poster"),
    ...visual.filter((reference) => reference.referenceRole !== "video-poster")
  ].slice(0, 3).concat(
    validated.filter((reference) => reference.contentType.startsWith("audio/") && reference.size <= 15_000_000).slice(0, 2)
  );
  const analyses = Object.fromEntries((await Promise.all(analyzable.map(async (reference) => {
    try {
      const stored = await getFromR2(reference.key);
      if (!stored.body) return undefined;
      const bytes = Buffer.from(await stored.body.transformToByteArray());
      if (reference.contentType.startsWith("image/")) {
        if (!hasCloudflareAI()) return undefined;
        const result = await analyzeCloudflareImage(bytes);
        return [reference.key, { text: result.description, kind: "visual" as const }] as const;
      }
      const actualDurationSeconds = inspectAudio(bytes)?.durationSeconds;
      if (!hasCloudflareAI()) {
        return [reference.key, { actualDurationSeconds }] as const;
      }
      const result = await transcribeCloudflareAudio(bytes);
      return [reference.key, {
        text: result.transcript,
        kind: "transcript" as const,
        actualDurationSeconds
      }] as const;
    } catch (error) {
      console.warn(`[reference-assets] Unable to analyze ${reference.key}:`, error);
      return undefined;
    }
  }))).filter(Boolean) as Array<readonly [string, {
    text?: string;
    kind?: "visual" | "transcript";
    actualDurationSeconds?: number;
  }]>);

  return validated.map((reference) => ({
    ...reference,
    analysis: analyses[reference.key]?.text,
    analysisKind: analyses[reference.key]?.kind,
    actualDurationSeconds: analyses[reference.key]?.actualDurationSeconds ?? reference.actualDurationSeconds
  }));
}
