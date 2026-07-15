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

export async function generateAzureChineseSpeech(text: string) {
  const key = getOptionalEnv("AZURE_SPEECH_KEY");
  const region = getOptionalEnv("AZURE_SPEECH_REGION");
  if (!key || !region) throw new Error("Chinese speech service is not configured");

  const voice = getOptionalEnv("AZURE_SPEECH_CHINESE_VOICE") || DEFAULT_CHINESE_VOICE;
  const ssml = `<speak version="1.0" xml:lang="zh-CN"><voice name="${escapeXml(voice)}"><prosody rate="0%">${escapeXml(text)}</prosody></voice></speak>`;
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
    contentType: "audio/mpeg" as const,
    extension: "mp3" as const
  };
}
