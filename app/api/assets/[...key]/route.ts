import { NextResponse } from "next/server";
import { getFromR2 } from "@/lib/r2";

export async function GET(
  request: Request,
  context: { params: Promise<{ key: string[] }> }
) {
  const { key } = await context.params;
  const r2Key = key.join("/");

  try {
    const requestedRange = request.headers.get("range") ?? undefined;
    const asset = await getFromR2(r2Key, requestedRange);
    if (!asset.body) {
      return NextResponse.json({ error: "Asset body is empty" }, { status: 404 });
    }

    const body = asset.body.transformToWebStream();
    return new NextResponse(body, {
      status: asset.contentRange ? 206 : 200,
      headers: {
        "accept-ranges": "bytes",
        "cache-control": asset.contentRange
          ? "private, no-store"
          : "public, max-age=31536000, immutable",
        "content-type": asset.contentType,
        vary: "range",
        ...(asset.contentLength ? { "content-length": String(asset.contentLength) } : {}),
        ...(asset.contentRange ? { "content-range": asset.contentRange } : {}),
        ...(asset.etag ? { etag: asset.etag } : {}),
        ...(asset.lastModified ? { "last-modified": asset.lastModified.toUTCString() } : {})
      }
    });
  } catch (error) {
    console.error("[asset-route] Unable to read R2 asset:", error);
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }
}
