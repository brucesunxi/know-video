import { getOptionalEnv } from "@/lib/env";
import { assertUsableSpeechAudio } from "@/lib/audio-quality";

const STANDARD_IMAGE_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";
const PREMIUM_IMAGE_MODEL = "@cf/black-forest-labs/flux-2-klein-9b";
const DEFAULT_TTS_MODEL = "@cf/myshell-ai/melotts";

type CloudflareEnvelope<T> = {
  success?: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
};

export function hasCloudflareAI() {
  return Boolean(getOptionalEnv("CLOUDFLARE_AI_ACCOUNT_ID") && getOptionalEnv("CLOUDFLARE_AI_TOKEN"));
}

function endpoint(model: string) {
  const accountId = getOptionalEnv("CLOUDFLARE_AI_ACCOUNT_ID");
  if (!accountId) throw new Error("Cloudflare AI account is not configured");
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
}

function authorizationHeaders() {
  const token = getOptionalEnv("CLOUDFLARE_AI_TOKEN");
  if (!token) throw new Error("Cloudflare AI token is not configured");
  return { authorization: `Bearer ${token}` };
}

async function responseError(response: Response) {
  const body = await response.json().catch(() => undefined) as CloudflareEnvelope<unknown> | undefined;
  const detail = body?.errors?.map((error) => error.message).filter(Boolean).join("; ");
  const error = new Error(detail || `AI service returned ${response.status}`) as Error & {
    status?: number;
    code?: string;
  };
  error.status = response.status;
  error.code = body?.errors?.[0]?.code?.toString();
  return error;
}

function decodeBase64(value: string) {
  const encoded = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  return Buffer.from(encoded, "base64");
}

function detectedAudioFormat(body: Buffer) {
  const isWave = body.length >= 12
    && body.subarray(0, 4).toString("ascii") === "RIFF"
    && body.subarray(8, 12).toString("ascii") === "WAVE";
  if (isWave) return { contentType: "audio/wav", extension: "wav" } as const;

  const isMp3 = body.length >= 3 && (
    body.subarray(0, 3).toString("ascii") === "ID3"
    || (body[0] === 0xff && (body[1] & 0xe0) === 0xe0)
  );
  if (isMp3) return { contentType: "audio/mpeg", extension: "mp3" } as const;

  throw new Error("AI speech service returned an unsupported audio format");
}

function unwrapResult<T>(payload: CloudflareEnvelope<T> | T) {
  return (payload as CloudflareEnvelope<T>).result ?? payload as T;
}

function retryableStatus(status: number) {
  return [408, 429, 500, 502, 503, 504].includes(status);
}

function retryDelay(attempt: number) {
  return 700 * (2 ** attempt) + Math.floor(Math.random() * 250);
}

async function wait(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function generateCloudflareImage(
  prompt: string,
  quality: "standard" | "premium" = "standard",
  options: {
    seed?: number;
    guidance?: number;
    references?: Array<{ body: Buffer; contentType: string }>;
  } = {}
) {
  const model = quality === "premium"
    ? getOptionalEnv("CLOUDFLARE_PREMIUM_IMAGE_MODEL") || PREMIUM_IMAGE_MODEL
    : getOptionalEnv("CLOUDFLARE_IMAGE_MODEL") || STANDARD_IMAGE_MODEL;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const form = new FormData();
      form.append("prompt", prompt);
      form.append("width", "1280");
      form.append("height", "720");
      form.append("steps", "4");
      if (options.seed !== undefined) form.append("seed", String(options.seed));
      form.append("guidance", String(options.guidance ?? (quality === "premium" ? 4 : 3.5)));
      options.references?.slice(0, 4).forEach((reference, index) => {
        const bytes = reference.body.buffer.slice(
          reference.body.byteOffset,
          reference.body.byteOffset + reference.body.byteLength
        ) as ArrayBuffer;
        form.append(
          `input_image_${index}`,
          new Blob([bytes], { type: reference.contentType }),
          `reference-${index}.${reference.contentType === "image/png" ? "png" : "jpg"}`
        );
      });
      const response = await fetch(endpoint(model), {
        method: "POST",
        headers: authorizationHeaders(),
        body: form,
        signal: AbortSignal.timeout(110_000)
      });
      if (!response.ok) {
        const error = await responseError(response);
        if (!retryableStatus(response.status) || attempt === 2) throw error;
        lastError = error;
      } else {
        const payload = await response.json() as CloudflareEnvelope<{ image?: string }> | { image?: string };
        const result = unwrapResult(payload);
        if (!result?.image) throw new Error("AI image service returned no image");
        return { body: decodeBase64(result.image), model };
      }
    } catch (error) {
      lastError = error;
      if (attempt === 2 || ((error as { status?: number }).status && !retryableStatus((error as { status: number }).status))) {
        throw error;
      }
    }
    await wait(retryDelay(attempt));
  }
  throw lastError instanceof Error ? lastError : new Error("AI image service failed after retries");
}

function speechLanguage(text: string) {
  if (/\p{Script=Han}/u.test(text)) return "zh";
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) return "ja";
  if (/\p{Script=Hangul}/u.test(text)) return "ko";
  return "en";
}

export async function generateCloudflareSpeech(text: string) {
  const model = getOptionalEnv("CLOUDFLARE_TTS_MODEL") || DEFAULT_TTS_MODEL;
  const response = await fetch(endpoint(model), {
    method: "POST",
    headers: {
      ...authorizationHeaders(),
      accept: "audio/mpeg",
      "content-type": "application/json"
    },
    body: JSON.stringify({ prompt: text, lang: speechLanguage(text) }),
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) throw await responseError(response);

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("audio/")) {
    const body = Buffer.from(await response.arrayBuffer());
    assertUsableSpeechAudio(body);
    return { body, model, ...detectedAudioFormat(body) };
  }

  const payload = await response.json() as CloudflareEnvelope<{ audio?: string }> | { audio?: string };
  const result = unwrapResult(payload);
  if (!result?.audio) throw new Error("AI speech service returned no audio");
  const body = decodeBase64(result.audio);
  assertUsableSpeechAudio(body);
  return { body, model, ...detectedAudioFormat(body) };
}
