import OpenAI from "openai";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { neon } from "@neondatabase/serverless";

function failure(error) {
  return {
    ok: false,
    status: typeof error?.status === "number" ? error.status : undefined,
    code: typeof error?.code === "string" ? error.code : undefined,
    message: error instanceof Error ? error.message.slice(0, 180) : "Unknown error"
  };
}

const report = {};

try {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  await client.models.list();
  report.imageProvider = { ok: true };
} catch (error) {
  report.imageProvider = failure(error);
}

try {
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
  });
  await client.send(new HeadBucketCommand({ Bucket: process.env.R2_BUCKET }));
  report.r2 = { ok: true };
} catch (error) {
  report.r2 = failure(error);
}

try {
  const sql = neon(process.env.DATABASE_URL);
  const [counts] = await sql`
    select
      (select count(*)::int from projects) as projects,
      (select count(*)::int from scenes) as scenes,
      (select count(*)::int from scene_assets where asset_type = 'image') as images
  `;
  report.database = { ok: true, counts };
} catch (error) {
  report.database = failure(error);
}

console.log(JSON.stringify(report, null, 2));
