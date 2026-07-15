import { getOptionalEnv } from "@/lib/env";

const DEFAULT_IMAGE_MODEL = "@cf/black-forest-labs/flux-2-klein-9b";
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

function unwrapResult<T>(payload: CloudflareEnvelope<T> | T) {
  return (payload as CloudflareEnvelope<T>).result ?? payload as T;
}

export async function generateCloudflareImage(prompt: string) {
  const model = getOptionalEnv("CLOUDFLARE_IMAGE_MODEL") || DEFAULT_IMAGE_MODEL;
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("width", "1280");
  form.append("height", "720");
  form.append("steps", "25");

  const response = await fetch(endpoint(model), {
    method: "POST",
    headers: authorizationHeaders(),
    body: form,
    signal: AbortSignal.timeout(110_000)
  });
  if (!response.ok) throw await responseError(response);

  const payload = await response.json() as CloudflareEnvelope<{ image?: string }> | { image?: string };
  const result = unwrapResult(payload);
  if (!result?.image) throw new Error("AI image service returned no image");
  return { body: decodeBase64(result.image), model };
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
    return { body: Buffer.from(await response.arrayBuffer()), model };
  }

  const payload = await response.json() as CloudflareEnvelope<{ audio?: string }> | { audio?: string };
  const result = unwrapResult(payload);
  if (!result?.audio) throw new Error("AI speech service returned no audio");
  return { body: decodeBase64(result.audio), model };
}
