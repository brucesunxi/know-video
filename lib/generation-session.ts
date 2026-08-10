import type { GenerationOptions } from "@/lib/types";

export const PENDING_GENERATION_STORAGE_KEY = "know-video:pending-generation";
export const PENDING_GENERATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type PendingGenerationSession = {
  requestId: string;
  prompt: string;
  options: GenerationOptions;
  startedAt: number;
};

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parsePendingGenerationSession(raw: string | null, now = Date.now()): PendingGenerationSession | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<PendingGenerationSession>;
    if (
      typeof value.requestId !== "string"
      || !requestIdPattern.test(value.requestId)
      || typeof value.prompt !== "string"
      || value.prompt.trim().length < 4
      || typeof value.startedAt !== "number"
      || value.startedAt > now
      || now - value.startedAt > PENDING_GENERATION_MAX_AGE_MS
      || !value.options
      || !["15", "30", "45", "60"].includes(value.options.duration)
      || !["auto", "3", "5", "6"].includes(value.options.sceneCount)
      || !["中文", "英文"].includes(value.options.language)
      || !["电影质感", "极简高级", "明快有活力", "温暖自然"].includes(value.options.style)
      || (value.options.visualStyleId !== undefined && typeof value.options.visualStyleId !== "string")
      || (value.options.visualStyleLabel !== undefined && typeof value.options.visualStyleLabel !== "string")
      || (value.options.visualStylePrompt !== undefined && typeof value.options.visualStylePrompt !== "string")
      || !["camera", "key-scenes"].includes(value.options.motion)
      || !["economy", "balanced"].includes(value.options.videoTier)
      || (value.options.narrationVoice !== undefined && !["male-clear", "male-deep", "female-natural"].includes(value.options.narrationVoice))
    ) {
      return undefined;
    }
    return {
      requestId: value.requestId,
      prompt: value.prompt.trim(),
      options: value.options,
      startedAt: value.startedAt
    };
  } catch {
    return undefined;
  }
}
