import { getOptionalEnv } from "@/lib/env";

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

function speechRate(text: string, durationSeconds?: number) {
  if (!durationSeconds) return 0;
  const hanCharacters = (text.match(/\p{Script=Han}/gu) ?? []).length;
  const latinWords = (text.match(/[A-Za-z0-9]+/g) ?? []).length;
  const punctuationPauses = (text.match(/[，。！？；,.!?;]/g) ?? []).length * 0.16;
  const estimatedSeconds = hanCharacters / 4.15 + latinWords / 2.7 + punctuationPauses;
  const availableSeconds = Math.max(1.5, durationSeconds - 0.45);
  return Math.max(-10, Math.min(35, Math.round((estimatedSeconds / availableSeconds - 1) * 100)));
}

export async function generateAzureChineseSpeech(text: string, durationSeconds?: number) {
  const key = getOptionalEnv("AZURE_SPEECH_KEY");
  const region = getOptionalEnv("AZURE_SPEECH_REGION");
  if (!key || !region) throw new Error("Chinese speech service is not configured");

  const voice = getOptionalEnv("AZURE_SPEECH_CHINESE_VOICE") || DEFAULT_CHINESE_VOICE;
  const rate = speechRate(text, durationSeconds);
  const ssmlRate = `${rate >= 0 ? "+" : ""}${rate}%`;
  const ssml = `<speak version="1.0" xml:lang="zh-CN"><voice name="${escapeXml(voice)}"><prosody rate="${ssmlRate}">${escapeXml(text)}</prosody></voice></speak>`;
  const response = await fetch(
    `https://${encodeURIComponent(region)}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
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
    throw new Error(detail || `Chinese speech service returned ${response.status}`);
  }

  const body = Buffer.from(await response.arrayBuffer());
  if (body.length < 1_000) throw new Error("Chinese speech service returned an empty audio file");

  return {
    body,
    model: "neural-tts",
    voice,
    rate,
    contentType: "audio/mpeg" as const,
    extension: "mp3" as const
  };
}
