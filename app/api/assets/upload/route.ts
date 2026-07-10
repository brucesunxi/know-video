import { NextResponse } from "next/server";
import { uploadToR2 } from "@/lib/r2";

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const projectId = String(form.get("projectId") ?? "unassigned");
  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const key = `uploads/${projectId}/${crypto.randomUUID()}-${safeName}`;
  const asset = await uploadToR2({
    key,
    body: buffer,
    contentType: file.type || "application/octet-stream"
  });

  return NextResponse.json({
    asset: {
      id: crypto.randomUUID(),
      type: file.type.startsWith("audio/") ? "audio" : file.type.startsWith("video/") ? "clip" : "image",
      url: asset.publicUrl,
      r2Key: asset.key,
      metadata: {
        name: file.name,
        size: file.size,
        contentType: file.type
      }
    }
  });
}
