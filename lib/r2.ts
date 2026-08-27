import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getOptionalEnv, getRequiredEnv } from "@/lib/env";

const R2_UPLOAD_TIMEOUT_MS = 60_000;
const R2_READ_TIMEOUT_MS = 60_000;
const R2_HEAD_TIMEOUT_MS = 20_000;
const R2_DELETE_TIMEOUT_MS = 45_000;
let r2Client: S3Client | undefined;

function operationSignal(timeoutMs: number) {
  return AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs)));
}

export function createR2Client() {
  if (r2Client) return r2Client;
  const accountId = getRequiredEnv("R2_ACCOUNT_ID");

  r2Client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: getRequiredEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: getRequiredEnv("R2_SECRET_ACCESS_KEY")
    }
  });
  return r2Client;
}

export async function uploadToR2(input: {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType: string;
  timeoutMs?: number;
}) {
  const bucket = getRequiredEnv("R2_BUCKET");
  const client = createR2Client();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType
    }),
    { abortSignal: operationSignal(input.timeoutMs ?? R2_UPLOAD_TIMEOUT_MS) }
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
    }),
    { abortSignal: operationSignal(R2_READ_TIMEOUT_MS) }
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

export async function readR2Prefix(key: string, bytes = 64) {
  const object = await getFromR2(key, `bytes=0-${Math.max(0, bytes - 1)}`);
  if (!object.body) throw new Error("Stored object has no body");
  return Buffer.from(await object.body.transformToByteArray());
}

export async function headR2Object(key: string) {
  const response = await createR2Client().send(
    new HeadObjectCommand({
      Bucket: getRequiredEnv("R2_BUCKET"),
      Key: key
    }),
    { abortSignal: operationSignal(R2_HEAD_TIMEOUT_MS) }
  );
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
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: unique.slice(index, index + 1000).map((Key) => ({ Key })),
          Quiet: true
        }
      }),
      { abortSignal: operationSignal(R2_DELETE_TIMEOUT_MS) }
    );
  }
}

export function assetUrlForKey(key: string, publicUrl?: string) {
  if (publicUrl) return publicUrl;
  return `/api/assets/${key.split("/").map(encodeURIComponent).join("/")}`;
}
