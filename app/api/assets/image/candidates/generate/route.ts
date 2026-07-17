import { NextResponse } from "next/server";
import { z } from "zod";
import { generateProjectSceneImages } from "@/lib/image-assets";
import { loadCurrentProjectForEdit, persistGeneratedSceneAssets } from "@/lib/project-mutations";

const schema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid(),
  sceneNumber: z.number().int().positive(),
  quality: z.enum(["standard", "premium"]).default("standard")
});

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const project = await loadCurrentProjectForEdit(body.projectId, body.versionId);
    if (!project) return NextResponse.json({ error: "视频版本已经发生变化，请刷新后重试。" }, { status: 409 });
    const scene = project.currentVersion.scenes.find((item) => item.sceneNumber === body.sceneNumber);
    if (!scene) return NextResponse.json({ error: "没有找到要生成候选画面的场景。" }, { status: 404 });
    if (!scene.assets.some((asset) => asset.type === "image" && asset.url)) {
      return NextResponse.json({ error: "请先生成当前场景画面，再创建视觉候选。" }, { status: 409 });
    }
    const candidates = scene.assets.filter((asset) => asset.type === "thumbnail" && asset.metadata?.candidate === true);
    if (candidates.length >= 3) {
      return NextResponse.json({ error: "每个场景最多保留 3 张候选画面，请先移除不需要的候选。" }, { status: 409 });
    }

    const previousKeys = new Set(candidates.map((asset) => asset.r2Key));
    const updated = await generateProjectSceneImages(project, {
      candidate: true,
      quality: body.quality,
      replaceExistingImages: false,
      sceneNumbers: [body.sceneNumber],
      variantKey: crypto.randomUUID()
    });
    const updatedScene = updated.currentVersion.scenes.find((item) => item.sceneNumber === body.sceneNumber);
    const candidate = updatedScene?.assets.find((asset) => (
      asset.type === "thumbnail" && asset.metadata?.candidate === true && !previousKeys.has(asset.r2Key)
    ));
    if (!candidate) {
      return NextResponse.json({ error: "候选画面没有生成成功，请稍后重试。" }, { status: 502 });
    }
    await persistGeneratedSceneAssets(updated.currentVersion.id, updated.currentVersion.scenes, {
      invalidateRender: false,
      sceneNumbers: [body.sceneNumber]
    });
    return NextResponse.json({ project: updated, candidate });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "候选画面请求格式无效。" }, { status: 400 });
    console.error("[image-candidates] Unable to generate candidate:", error);
    return NextResponse.json({ error: "候选画面生成失败，请稍后重试。" }, { status: 502 });
  }
}
