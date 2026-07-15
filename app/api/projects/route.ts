import { NextResponse } from "next/server";
import { z } from "zod";
import { createStoryboardProject } from "@/lib/ai-video";
import { generateProjectSceneImages } from "@/lib/image-assets";
import { generateProjectVoices } from "@/lib/audio-assets";
import { persistGeneratedProject } from "@/lib/project-mutations";

const requestSchema = z.object({
  prompt: z.string().min(4),
  baseProject: z.unknown().optional()
});

export const maxDuration = 120;

function publicEngine(engine: string) {
  return engine === "heuristic" ? "heuristic" : "ai";
}

export async function POST(request: Request) {
  const body = requestSchema.parse(await request.json());
  const { project, engine } = await createStoryboardProject(body.prompt);
  const projectWithImages = await generateProjectSceneImages(project);
  const projectWithMedia = await generateProjectVoices(projectWithImages);
  const persisted = await persistGeneratedProject({
    prompt: body.prompt,
    project: projectWithMedia,
    engine
  });

  return NextResponse.json({ ...persisted, engine: publicEngine(engine) });
}
