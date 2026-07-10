import { NextResponse } from "next/server";
import { getFromR2 } from "@/lib/r2";

export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string[] }> }
) {
  const { key } = await context.params;
  const r2Key = key.join("/");

  try {
    const asset = await getFromR2(r2Key);
    if (!asset.body) {
      return NextResponse.json({ error: "Asset body is empty" }, { status: 404 });
    }

    const bytes = await asset.body.transformToByteArray();
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "cache-control": "public, max-age=31536000, immutable",
        "content-type": asset.contentType
      }
    });
  } catch (error) {
    console.error("[asset-route] Unable to read R2 asset:", error);
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }
}
