import { NextResponse } from "next/server";
import { z } from "zod";
import { assertProjectOwner, authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { matchesDeclaredAssetType, maxUploadBytes, uploadedAssetType } from "@/lib/asset-policy";
import { loadCurrentProjectForEdit } from "@/lib/project-mutations";
import { attachProductionAsset, createProductionAsset, findOwnedVersionAnchor } from "@/lib/production-assets";
import { headR2Object, readR2Prefix } from "@/lib/r2";
import { deleteUnreferencedStorageObjects } from "@/lib/storage-cleanup";

const schema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid(),
  type: z.enum(["logo", "music"]),
  key: z.string().min(1).max(800),
  name: z.string().min(1).max(240),
  size: z.number().int().positive().max(80_000_000),
  contentType: z.string().min(1).max(120)
});

export async function POST(request: Request) {
  let uploadedKey: string | undefined;
  let ownsUploadedKey = false;
  const cleanupUpload = async () => {
    if (uploadedKey && ownsUploadedKey) {
      await deleteUnreferencedStorageObjects([uploadedKey]).catch(() => undefined);
    }
  };
  try {
    const user = await requireCurrentUser();
    const body = schema.parse(await request.json());
    await assertProjectOwner(body.projectId, user.id);
    uploadedKey = body.key;
    if (!body.key.startsWith(`uploads/${body.projectId}/production/${body.type}/`)) {
      return NextResponse.json({ error: "成片素材上传路径无效。" }, { status: 403 });
    }
    ownsUploadedKey = true;
    const uploadedType = uploadedAssetType(body.contentType);
    if ((body.type === "logo" && uploadedType !== "image") || (body.type === "music" && uploadedType !== "audio")) {
      await cleanupUpload();
      return NextResponse.json({ error: "成片素材格式无效。" }, { status: 415 });
    }
    if (body.size > maxUploadBytes(body.contentType)) {
      await cleanupUpload();
      return NextResponse.json({ error: "成片素材文件过大。" }, { status: 413 });
    }
    if (!await findOwnedVersionAnchor(body)) {
      await cleanupUpload();
      return NextResponse.json({ error: "没有找到当前视频版本。" }, { status: 404 });
    }
    const stored = await headR2Object(body.key);
    if (stored.contentLength !== body.size || stored.contentType !== body.contentType) {
      await cleanupUpload();
      return NextResponse.json({ error: "云端素材的大小或格式校验失败。" }, { status: 409 });
    }
    if (!matchesDeclaredAssetType(await readR2Prefix(body.key), body.contentType)) {
      await cleanupUpload();
      return NextResponse.json({ error: "文件内容与声明格式不一致。" }, { status: 415 });
    }
    const asset = createProductionAsset({ ...body });
    await attachProductionAsset({ projectId: body.projectId, versionId: body.versionId, asset });
    const project = await loadCurrentProjectForEdit(body.projectId, body.versionId, user.id);
    if (!project) throw new Error("视频版本已经发生变化，请刷新后重试。");
    return NextResponse.json({ asset, project });
  } catch (error) {
    await cleanupUpload();
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
      return NextResponse.json({ error: "没有找到当前视频项目。" }, { status: 404 });
    }
    const invalidRequest = error instanceof z.ZodError;
    return NextResponse.json(
      { error: invalidRequest ? "成片素材信息无效。" : error instanceof Error ? error.message : "成片素材绑定失败。" },
      { status: invalidRequest ? 400 : 502 }
    );
  }
}
