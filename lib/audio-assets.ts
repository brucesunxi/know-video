import OpenAI from "openai";
import { assertUsableSpeechAudio } from "@/lib/audio-quality";
import { generateAzureSpeech, hasAzureSpeech } from "@/lib/azure-speech";
import { getOptionalEnv } from "@/lib/env";
import { sanitizeNarrationForSpeech } from "@/lib/narration-cleanup";
import { assetUrlForKey, uploadToR2 } from "@/lib/r2";
import { estimateNarrationSeconds } from "@/lib/speech-timing";
import { DEFAULT_NARRATION_VOICE, narrationVoiceProfile } from "@/lib/voice-profiles";
import type { NarrationVoice, Project, Scene, SceneAsset } from "@/lib/types";
import { boundedOperationTimeout } from "@/lib/operation-deadline";

export type VoiceGenerationOptions = {
  deadlineMs?: number;
  azureMaxAttempts?: number;
  allowOpenAIFallback?: boolean;
};

function containsChinese(text: string) {
  return /\p{Script=Han}/u.test(text);
}

function openAISpeechFallbackEnabled(options: VoiceGenerationOptions) {
  return options.allowOpenAIFallback === true
    && getOptionalEnv("ENABLE_OPENAI_TTS_FALLBACK")?.toLowerCase() === "true"
    && Boolean(getOptionalEnv("OPENAI_API_KEY"));
}

async function generateOpenAISpeech(
  text: string,
  targetDurationSeconds: number,
  expectedTextDurationSeconds: number,
  direction: string,
  options: VoiceGenerationOptions
) {
  const apiKey = getOptionalEnv("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OpenAI speech backup is not configured");
  const timeout = boundedOperationTimeout({
    operation: "OpenAI speech generation",
    deadlineMs: options.deadlineMs,
    maxTimeoutMs: 75_000,
    reserveMs: 8_000,
    minimumTimeoutMs: 5_000
  });
  const client = new OpenAI({ apiKey, timeout, maxRetries: 0 });
  const model = getOptionalEnv("OPENAI_TTS_MODEL") || "gpt-4o-mini-tts";
  const voice = getOptionalEnv("OPENAI_TTS_VOICE") || "alloy";
  const result = await client.audio.speech.create({
    model,
    voice: voice as "alloy",
    input: text,
    response_format: "wav",
    instructions: `${direction} Speak only the exact input text. Never add an introduction, summary, title, label, commentary, or closing phrase. Use one consistent natural speaking pace. Clear pronunciation, no sound effects. Do not speed up or slow down to match a target duration.`
  });
  const body = Buffer.from(await result.arrayBuffer());
  const inspection = assertUsableSpeechAudio(body, {
    targetDurationSeconds,
    expectedTextDurationSeconds
  });
  return {
    body,
    model,
    voice,
    contentType: "audio/wav" as const,
    extension: "wav" as const,
    actualDurationSeconds: inspection.durationSeconds
  };
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
}

async function generateSceneVoice(
  scene: Scene,
  project: Project,
  narrationVoice?: NarrationVoice,
  options: VoiceGenerationOptions = {}
): Promise<{ asset: SceneAsset; voiceover: string }> {
  let body: Buffer;
  let model: string;
  let voice: string;
  let contentType: "audio/mpeg" | "audio/wav";
  let extension: "mp3" | "wav";
  let rate: number | undefined;
  let actualDurationSeconds: number | undefined;
  const voiceover = sanitizeNarrationForSpeech(scene.voiceover);
  if (!voiceover) {
    throw new Error(`Scene ${scene.sceneNumber} narration contains only video-description meta commentary`);
  }
  const expectedTextDurationSeconds = estimateNarrationSeconds(voiceover);
  const selectedVoice = narrationVoice ?? scene.style.narrationVoice ?? DEFAULT_NARRATION_VOICE;
  const profile = narrationVoiceProfile(selectedVoice);
  const narrationLanguage = containsChinese(voiceover) ? "zh-CN" : "en-US";
  const direction = narrationLanguage === "zh-CN" ? profile.directionZh : profile.directionEn;
  const azureConfigured = hasAzureSpeech();
  try {
    if (!azureConfigured) throw new Error("Azure speech service is not configured");
    const generated = await generateAzureSpeech(
      voiceover,
      scene.durationSeconds,
      selectedVoice,
      narrationLanguage,
      { deadlineMs: options.deadlineMs, maxAttempts: options.azureMaxAttempts }
    );
    body = generated.body;
    model = generated.model;
    voice = generated.voice;
    rate = generated.rate;
    actualDurationSeconds = generated.actualDurationSeconds;
    contentType = generated.contentType;
    extension = generated.extension;
  } catch (azureError) {
    if (!openAISpeechFallbackEnabled(options)) throw azureError;
    console.error(`[audio-assets] Azure ${narrationLanguage} speech failed, using explicitly enabled OpenAI backup:`, azureError);
    const generated = await generateOpenAISpeech(
      voiceover,
      scene.durationSeconds,
      expectedTextDurationSeconds,
      direction,
      options
    );
    ({ body, model, voice, contentType, extension, actualDurationSeconds } = generated);
  }
  const inspection = assertUsableSpeechAudio(body, {
    targetDurationSeconds: scene.durationSeconds,
    expectedTextDurationSeconds
  });
  actualDurationSeconds ??= inspection.durationSeconds;
  const key = `generated/${project.id}/${project.currentVersion.id}/scene-${scene.sceneNumber}-voice-${crypto.randomUUID()}.${extension}`;
  const uploaded = await uploadToR2({
    key,
    body,
    contentType,
    timeoutMs: boundedOperationTimeout({
      operation: "Generated narration upload",
      deadlineMs: options.deadlineMs,
      maxTimeoutMs: 35_000,
      reserveMs: 6_000,
      minimumTimeoutMs: 3_000
    })
  });

  const asset: SceneAsset = {
    id: crypto.randomUUID(),
    type: "audio",
    r2Key: uploaded.key,
    url: assetUrlForKey(uploaded.key, uploaded.publicUrl),
    metadata: {
      source: "ai-speech",
      model,
      voice,
      contentType,
      sceneNumber: scene.sceneNumber,
      targetDurationSeconds: scene.durationSeconds,
      expectedTextDurationSeconds,
      rate,
      actualDurationSeconds,
      audibleStartSeconds: inspection.audibleStartSeconds,
      audibleEndSeconds: inspection.audibleEndSeconds,
      trailingSilenceSeconds: inspection.trailingSilenceSeconds,
      narrationVoice: selectedVoice
    }
  };
  console.info(
    `[audio-assets] Scene ${scene.sceneNumber} timing: expected=${expectedTextDurationSeconds.toFixed(2)}s actual=${(actualDurationSeconds ?? inspection.durationSeconds).toFixed(2)}s target=${scene.durationSeconds.toFixed(2)}s rate=${rate ?? 0}% voice=${selectedVoice}.`
  );
  return { asset, voiceover };
}

export async function generateProjectVoices(
  project: Project,
  sceneNumbers?: number[],
  narrationVoice?: NarrationVoice,
  options: VoiceGenerationOptions = {}
) {
  if (
    (!hasAzureSpeech() && !openAISpeechFallbackEnabled(options))
    || getOptionalEnv("ENABLE_TTS") === "false"
  ) {
    return {
      ...project,
      currentVersion: {
        ...project.currentVersion,
        renderUrl: undefined,
        status: "draft" as const
      }
    };
  }
  const selected = sceneNumbers ? new Set(sceneNumbers) : undefined;
  const scenes = [...project.currentVersion.scenes];
  const selectedIndexes = scenes
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) => !selected || selected.has(scene.sceneNumber));
  const concurrency = Math.min(3, Math.max(1, Number(getOptionalEnv("TTS_GENERATION_CONCURRENCY")) || 2));
  await mapWithConcurrency(selectedIndexes, concurrency, async ({ scene, index }) => {
    try {
      const generated = await generateSceneVoice(scene, project, narrationVoice, options);
      scenes[index] = {
        ...scene,
        voiceover: generated.voiceover,
        style: narrationVoice ? { ...scene.style, narrationVoice } : scene.style,
        assets: [generated.asset, ...scene.assets.filter((asset) => asset.type !== "audio")]
      };
    } catch (error) {
      console.error(`[audio-assets] Scene ${scene.sceneNumber} voice generation failed:`, error);
      // A failed Chinese regeneration must not leave a previously broken MeloTTS track active.
      if (containsChinese(scene.voiceover)) {
        scenes[index] = { ...scene, assets: scene.assets.filter((asset) => asset.type !== "audio") };
      }
    }
  });

  return {
    ...project,
    currentVersion: {
      ...project.currentVersion,
      renderUrl: undefined,
      status: "draft" as const,
      scenes
    }
  };
}
