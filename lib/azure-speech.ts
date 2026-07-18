import { getOptionalEnv } from "@/lib/env";
import { assertUsableSpeechAudio } from "@/lib/audio-quality";
import {
  correctedSpeechRate,
  speechRateForDuration
} from "@/lib/speech-timing";
import { narrationVoiceProfile } from "@/lib/voice-profiles";
import type { NarrationVoice } from "@/lib/types";

const DEFAULT_CHINESE_VOICE = "zh-CN-YunxiNeural";

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
  text: string;
  rate: number;
}) {
  const ssmlRate = `${input.rate >= 0 ? "+" : ""}${input.rate}%`;
  const ssml = `<speak version="1.0" xml:lang="zh-CN"><voice name="${escapeXml(input.voice)}"><prosody rate="${ssmlRate}">${escapeXml(input.text)}</prosody></voice></speak>`;
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
        const error = new Error(detail || `Chinese speech service returned ${response.status}`) as Error & { status?: number };
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
  if (!body) throw lastError instanceof Error ? lastError : new Error("Chinese speech service failed after retries");
  if (body.length < 1_000) throw new Error("Chinese speech service returned an empty audio file");
  return body;
}

export async function generateAzureChineseSpeech(
  text: string,
  durationSeconds?: number,
  narrationVoice?: NarrationVoice
) {
  const key = getOptionalEnv("AZURE_SPEECH_KEY");
  const region = getOptionalEnv("AZURE_SPEECH_REGION");
  if (!key || !region) throw new Error("Chinese speech service is not configured");

  const voice = narrationVoice
    ? narrationVoiceProfile(narrationVoice).azureVoice
    : getOptionalEnv("AZURE_SPEECH_CHINESE_VOICE") || DEFAULT_CHINESE_VOICE;
  let rate = speechRateForDuration(text, durationSeconds);
  let body = await requestAzureSpeech({ key, region, voice, text, rate });
  let actualDurationSeconds = assertUsableSpeechAudio(body).durationSeconds;
  const targetSeconds = durationSeconds ? Math.max(1.3, durationSeconds - 0.18) : undefined;
  const timingRatio = targetSeconds ? actualDurationSeconds / targetSeconds : 1;
  const timingNeedsCorrection = timingRatio > 1.03 || timingRatio < 0.82;
  const rateCanMove = timingRatio > 1 ? rate < 45 : rate > -20;
  if (targetSeconds && timingNeedsCorrection && rateCanMove) {
    const nextRate = correctedSpeechRate(rate, actualDurationSeconds, targetSeconds);
    if (nextRate !== rate) {
      rate = nextRate;
      body = await requestAzureSpeech({ key, region, voice, text, rate });
      actualDurationSeconds = assertUsableSpeechAudio(body).durationSeconds;
    }
  }
  assertUsableSpeechAudio(body, { targetDurationSeconds: durationSeconds });

  return {
    body,
    model: "neural-tts",
    voice,
    rate,
    actualDurationSeconds,
    contentType: "audio/wav" as const,
    extension: "wav" as const
  };
}
