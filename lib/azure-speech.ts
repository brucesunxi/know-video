import { getOptionalEnv } from "@/lib/env";
import {
  correctedSpeechRate,
  estimateCbrMp3Duration,
  speechRateForDuration
} from "@/lib/speech-timing";

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

function looksLikeMp3(body: Buffer) {
  if (body.subarray(0, 3).toString("ascii") === "ID3") return true;
  const searchLength = Math.min(body.length - 1, 8_192);
  for (let index = 0; index < searchLength; index += 1) {
    if (body[index] === 0xff && (body[index + 1] & 0xe0) === 0xe0) return true;
  }
  return false;
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
            "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
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
  if (!looksLikeMp3(body)) throw new Error("Chinese speech service returned an invalid MP3 file");
  return body;
}

export async function generateAzureChineseSpeech(text: string, durationSeconds?: number) {
  const key = getOptionalEnv("AZURE_SPEECH_KEY");
  const region = getOptionalEnv("AZURE_SPEECH_REGION");
  if (!key || !region) throw new Error("Chinese speech service is not configured");

  const voice = getOptionalEnv("AZURE_SPEECH_CHINESE_VOICE") || DEFAULT_CHINESE_VOICE;
  let rate = speechRateForDuration(text, durationSeconds);
  let body = await requestAzureSpeech({ key, region, voice, text, rate });
  let actualDurationSeconds = estimateCbrMp3Duration(body, 48);
  const targetSeconds = durationSeconds ? Math.max(1.3, durationSeconds - 0.18) : undefined;
  if (targetSeconds && actualDurationSeconds > targetSeconds * 1.03 && rate < 45) {
    const nextRate = correctedSpeechRate(rate, actualDurationSeconds, targetSeconds);
    if (nextRate > rate) {
      rate = nextRate;
      body = await requestAzureSpeech({ key, region, voice, text, rate });
      actualDurationSeconds = estimateCbrMp3Duration(body, 48);
    }
  }
  if (durationSeconds && actualDurationSeconds > durationSeconds + 0.12) {
    throw new Error("旁白内容过长，无法在当前场景时长内自然读完。");
  }

  return {
    body,
    model: "neural-tts",
    voice,
    rate,
    actualDurationSeconds,
    contentType: "audio/mpeg" as const,
    extension: "mp3" as const
  };
}
