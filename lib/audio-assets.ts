import OpenAI from "openai";
import { assertUsableSpeechAudio } from "@/lib/audio-quality";
import { generateAzureChineseSpeech, hasAzureSpeech } from "@/lib/azure-speech";
import { generateCloudflareSpeech, hasCloudflareAI } from "@/lib/cloudflare-ai";
import { getOptionalEnv } from "@/lib/env";
import { assetUrlForKey, uploadToR2 } from "@/lib/r2";
import { DEFAULT_NARRATION_VOICE, narrationVoiceProfile } from "@/lib/voice-profiles";
import type { NarrationVoice, Project, Scene, SceneAsset } from "@/lib/types";

function containsChinese(text: string) {
  return /\p{Script=Han}/u.test(text);
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
  narrationVoice?: NarrationVoice
): Promise<SceneAsset> {
  let body: Buffer;
  let model: string;
  let voice: string;
  let contentType: "audio/mpeg" | "audio/wav";
  let extension: "mp3" | "wav";
  let rate: number | undefined;
  let actualDurationSeconds: number | undefined;
  const selectedVoice = narrationVoice ?? scene.style.narrationVoice ?? DEFAULT_NARRATION_VOICE;
  const profile = narrationVoiceProfile(selectedVoice);
  if (containsChinese(scene.voiceover)) {
    try {
      if (!hasAzureSpeech()) throw new Error("Chinese speech service is not configured");
      const generated = await generateAzureChineseSpeech(scene.voiceover, scene.durationSeconds, selectedVoice);
      body = generated.body;
      model = generated.model;
      voice = generated.voice;
      rate = generated.rate;
      actualDurationSeconds = generated.actualDurationSeconds;
      contentType = generated.contentType;
      extension = generated.extension;
    } catch (azureError) {
      const apiKey = getOptionalEnv("OPENAI_API_KEY");
      if (!apiKey) throw azureError;
      console.error("[audio-assets] Azure Chinese speech failed, trying verified backup:", azureError);
      const client = new OpenAI({ apiKey });
      model = getOptionalEnv("OPENAI_TTS_MODEL") || "gpt-4o-mini-tts";
      voice = getOptionalEnv("OPENAI_TTS_VOICE") || "alloy";
      const result = await client.audio.speech.create({
        model,
        voice: voice as "alloy",
        input: scene.voiceover,
        response_format: "wav",
        instructions: `${profile.direction} Clear pronunciation, no sound effects.`
      });
      body = Buffer.from(await result.arrayBuffer());
      const inspection = assertUsableSpeechAudio(body, { targetDurationSeconds: scene.durationSeconds });
      actualDurationSeconds = inspection.durationSeconds;
      contentType = "audio/wav";
      extension = "wav";
    }
  } else if (hasCloudflareAI()) {
    const generated = await generateCloudflareSpeech(scene.voiceover);
    body = generated.body;
    model = generated.model;
    voice = "default";
    contentType = generated.contentType;
    extension = generated.extension;
  } else {
    const client = new OpenAI({ apiKey: getOptionalEnv("OPENAI_API_KEY") });
    model = getOptionalEnv("OPENAI_TTS_MODEL") || "gpt-4o-mini-tts";
    voice = getOptionalEnv("OPENAI_TTS_VOICE") || "alloy";
    const result = await client.audio.speech.create({
      model,
      voice: voice as "alloy",
      input: scene.voiceover,
      response_format: "mp3",
      instructions: "Natural, confident product-film narration. Match the language of the text. Keep a composed, premium pace."
    });
    body = Buffer.from(await result.arrayBuffer());
    const inspection = assertUsableSpeechAudio(body, { targetDurationSeconds: scene.durationSeconds });
    actualDurationSeconds = inspection.durationSeconds;
    contentType = "audio/mpeg";
    extension = "mp3";
  }
  const inspection = assertUsableSpeechAudio(body, { targetDurationSeconds: scene.durationSeconds });
  actualDurationSeconds ??= inspection.durationSeconds;
  const key = `generated/${project.id}/${project.currentVersion.id}/scene-${scene.sceneNumber}-voice-${crypto.randomUUID()}.${extension}`;
  const uploaded = await uploadToR2({ key, body, contentType });

  return {
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
      rate,
      actualDurationSeconds,
      narrationVoice: selectedVoice
    }
  };
}

export async function generateProjectVoices(
  project: Project,
  sceneNumbers?: number[],
  narrationVoice?: NarrationVoice
) {
  if (
    (!hasAzureSpeech() && !hasCloudflareAI() && !getOptionalEnv("OPENAI_API_KEY"))
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
  const concurrency = Math.min(4, Math.max(1, Number(getOptionalEnv("TTS_GENERATION_CONCURRENCY")) || 3));
  await mapWithConcurrency(selectedIndexes, concurrency, async ({ scene, index }) => {
    try {
      const voice = await generateSceneVoice(scene, project, narrationVoice);
      scenes[index] = {
        ...scene,
        style: narrationVoice ? { ...scene.style, narrationVoice } : scene.style,
        assets: [voice, ...scene.assets.filter((asset) => asset.type !== "audio")]
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
      status: "draft",
      scenes
    }
  };
}
