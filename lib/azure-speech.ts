import { getOptionalEnv } from "@/lib/env";
import { assertUsableSpeechAudio } from "@/lib/audio-quality";
import { estimateNarrationSeconds } from "@/lib/speech-timing";
import { narrationVoiceProfile } from "@/lib/voice-profiles";
import type { NarrationVoice } from "@/lib/types";

const DEFAULT_CHINESE_VOICE = "zh-CN-YunxiNeural";
const DEFAULT_ENGLISH_VOICE = "en-US-GuyNeural";
export type AzureNarrationLanguage = "zh-CN" | "en-US";

export function hasAzureSpeech() {
  return Boolean(getOptionalEnv("AZURE_SPEECH_KEY") && getOptionalEnv("AZURE_SPEECH_REGION"));
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function requestAzureSpeech(input: {
  key: string;
  region: string;
  voice: string;
  language: AzureNarrationLanguage;
  text: string;
  pitch: number;
}) {
  const ssmlPitch = `${input.pitch >= 0 ? "+" : ""}${input.pitch}%`;
  const ssml = `<speak version="1.0" xml:lang="${input.language}"><voice name="${escapeXml(input.voice)}"><prosody pitch="${ssmlPitch}">${escapeXml(input.text)}</prosody></voice></speak>`;
  let body: Buffer | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(
        `https://${encodeURIComponent(input.region)}.tts.speech.microsoft.com/cognitiveservices/v1`,
        {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": input.key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
            "User-Agent": "KnowVideo"
          },
          body: ssml,
          signal: AbortSignal.timeout(60_000)
        }
      );
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).trim();
        const error = new Error(detail || `Azure speech service returned ${response.status}`) as Error & { status?: number };
        error.status = response.status;
        if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 2) throw error;
        lastError = error;
      } else {
        body = Buffer.from(await response.arrayBuffer());
        break;
      }
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number }).status;
      if (attempt === 2 || (status && ![408, 429, 500, 502, 503, 504].includes(status))) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt) + Math.floor(Math.random() * 180)));
  }
  if (!body) throw lastError instanceof Error ? lastError : new Error("Azure speech service failed after retries");
  if (body.length < 1_000) throw new Error("Azure speech service returned an empty audio file");
  return body;
}

export async function generateAzureSpeech(
  text: string,
  durationSeconds?: number,
  narrationVoice?: NarrationVoice,
  language: AzureNarrationLanguage = /\p{Script=Han}/u.test(text) ? "zh-CN" : "en-US"
) {
  const key = getOptionalEnv("AZURE_SPEECH_KEY");
  const region = getOptionalEnv("AZURE_SPEECH_REGION");
  if (!key || !region) throw new Error("Azure speech service is not configured");

  const profile = narrationVoiceProfile(narrationVoice);
  const voice = narrationVoice
    ? language === "zh-CN" ? profile.azureVoiceZh : profile.azureVoiceEn
    : language === "zh-CN"
      ? getOptionalEnv("AZURE_SPEECH_CHINESE_VOICE") || DEFAULT_CHINESE_VOICE
      : getOptionalEnv("AZURE_SPEECH_ENGLISH_VOICE") || DEFAULT_ENGLISH_VOICE;
  const expectedTextDurationSeconds = estimateNarrationSeconds(text);
  const body = await requestAzureSpeech({ key, region, voice, language, text, pitch: profile.pitch });
  const actualDurationSeconds = assertUsableSpeechAudio(body).durationSeconds;
  assertUsableSpeechAudio(body, {
    targetDurationSeconds: durationSeconds,
    expectedTextDurationSeconds
  });

  return {
    body,
    model: "neural-tts",
    voice,
    rate: 0,
    actualDurationSeconds,
    expectedTextDurationSeconds,
    contentType: "audio/wav" as const,
    extension: "wav" as const
  };
}
