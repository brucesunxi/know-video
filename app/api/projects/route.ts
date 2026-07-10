import { NextResponse } from "next/server";
import { z } from "zod";
import { createStoryboardProject } from "@/lib/ai-video";
import { persistGeneratedProject } from "@/lib/project-mutations";

const requestSchema = z.object({
  prompt: z.string().min(4),
  baseProject: z.unknown().optional()
});

function publicEngine(engine: string) {
  return engine === "heuristic" ? "heuristic" : "ai";
}

export async function POST(request: Request) {
  const body = requestSchema.parse(await request.json());
  const { project, engine } = await createStoryboardProject(body.prompt);
  const persisted = await persistGeneratedProject({
    prompt: body.prompt,
    project,
    engine
  });

  return NextResponse.json({ ...persisted, engine: publicEngine(engine) });
}
