import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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

export async function getFromR2(key: string, range?: string) {
  const bucket = getRequiredEnv("R2_BUCKET");
  const client = createR2Client();

  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: range
    })
  );

  return {
    body: response.Body,
    contentType: response.ContentType || "application/octet-stream",
    contentLength: response.ContentLength,
    contentRange: response.ContentRange,
    etag: response.ETag,
    lastModified: response.LastModified
  };
}

export async function headR2Object(key: string) {
  const response = await createR2Client().send(new HeadObjectCommand({
    Bucket: getRequiredEnv("R2_BUCKET"),
    Key: key
  }));
  return {
    contentLength: response.ContentLength,
    contentType: response.ContentType,
    etag: response.ETag
  };
}

export async function createPresignedUpload(input: { key: string; contentType: string }) {
  const command = new PutObjectCommand({
    Bucket: getRequiredEnv("R2_BUCKET"),
    Key: input.key,
    ContentType: input.contentType
  });
  return getSignedUrl(createR2Client(), command, { expiresIn: 15 * 60 });
}

export async function deleteR2Objects(keys: string[]) {
  const unique = Array.from(new Set(keys.filter(Boolean)));
  if (unique.length === 0) return;
  const client = createR2Client();
  const bucket = getRequiredEnv("R2_BUCKET");
  for (let index = 0; index < unique.length; index += 1000) {
    await client.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: unique.slice(index, index + 1000).map((Key) => ({ Key })),
        Quiet: true
      }
    }));
  }
}

export function assetUrlForKey(key: string, publicUrl?: string) {
  if (publicUrl) return publicUrl;
  return `/api/assets/${key.split("/").map(encodeURIComponent).join("/")}`;
}
