import { NextResponse } from "next/server";
import { z } from "zod";
import { generateProjectSceneImages } from "@/lib/image-assets";
import { persistGeneratedSceneAssets } from "@/lib/project-mutations";
import type { Project } from "@/lib/types";

const requestSchema = z.object({
  project: z.unknown(),
  sceneNumbers: z.array(z.number().int().positive()).optional()
});

export const maxDuration = 120;

export async function POST(request: Request) {
  const body = requestSchema.parse(await request.json());
  const project = body.project as Project;
  const updated = await generateProjectSceneImages(project, {
    replaceExistingImages: true,
    sceneNumbers: body.sceneNumbers
  });

  await persistGeneratedSceneAssets(updated.currentVersion.id, updated.currentVersion.scenes);

  if (updated.currentVersion.assetStatus === "failed") {
    return NextResponse.json(
      { error: "Scene image generation failed. Check the image API credential and server logs." },
      { status: 502 }
    );
  }

  return NextResponse.json({ project: updated });
}
