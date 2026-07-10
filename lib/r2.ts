import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getOptionalEnv, getRequiredEnv } from "@/lib/env";

export function createR2Client() {
  const accountId = getRequiredEnv("R2_ACCOUNT_ID");

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: getRequiredEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: getRequiredEnv("R2_SECRET_ACCESS_KEY")
    }
  });
}

export async function uploadToR2(input: {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType: string;
}) {
  const bucket = getRequiredEnv("R2_BUCKET");
  const client = createR2Client();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType
    })
  );

  const publicBaseUrl = getOptionalEnv("R2_PUBLIC_BASE_URL");
  return {
    key: input.key,
    publicUrl: publicBaseUrl ? `${publicBaseUrl.replace(/\/$/, "")}/${input.key}` : undefined
  };
}

export async function getFromR2(key: string) {
  const bucket = getRequiredEnv("R2_BUCKET");
  const client = createR2Client();

  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key
    })
  );

  return {
    body: response.Body,
    contentType: response.ContentType || "application/octet-stream"
  };
}

export function assetUrlForKey(key: string, publicUrl?: string) {
  if (publicUrl) return publicUrl;
  return `/api/assets/${key.split("/").map(encodeURIComponent).join("/")}`;
}
