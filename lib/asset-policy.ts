import type { AssetType } from "@/lib/types";

const contentTypes = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "audio/mpeg": "audio",
  "audio/wav": "audio",
  "audio/x-wav": "audio",
  "video/mp4": "clip",
  "video/webm": "clip"
} as const satisfies Record<string, AssetType>;

export function uploadedAssetType(contentType: string): AssetType | undefined {
  return contentTypes[contentType.trim().toLowerCase() as keyof typeof contentTypes];
}

export function supportedUploadContentTypes() {
  return Object.keys(contentTypes);
}

export function maxUploadBytes(contentType: string) {
  const type = uploadedAssetType(contentType);
  if (type === "image") return 25_000_000;
  if (type === "audio") return 80_000_000;
  if (type === "clip") return 500_000_000;
  return 0;
}

function ascii(body: Uint8Array, start: number, end: number) {
  return Buffer.from(body.subarray(start, end)).toString("ascii");
}

export function matchesDeclaredAssetType(body: Uint8Array, contentType: string) {
  if (body.length < 12) return false;
  const normalized = contentType.trim().toLowerCase();
  if (normalized === "image/jpeg") {
    return body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  }
  if (normalized === "image/png") {
    return body[0] === 0x89 && ascii(body, 1, 4) === "PNG";
  }
  if (normalized === "image/webp") {
    return ascii(body, 0, 4) === "RIFF" && ascii(body, 8, 12) === "WEBP";
  }
  if (normalized === "audio/mpeg") {
    return ascii(body, 0, 3) === "ID3" || (body[0] === 0xff && (body[1] & 0xe0) === 0xe0);
  }
  if (normalized === "audio/wav" || normalized === "audio/x-wav") {
    return ascii(body, 0, 4) === "RIFF" && ascii(body, 8, 12) === "WAVE";
  }
  if (normalized === "video/mp4") {
    return ascii(body, 4, 8) === "ftyp";
  }
  if (normalized === "video/webm") {
    return body[0] === 0x1a && body[1] === 0x45 && body[2] === 0xdf && body[3] === 0xa3;
  }
  return false;
}
