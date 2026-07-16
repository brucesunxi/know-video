import { NextResponse } from "next/server";
import { z } from "zod";
import { createStoryboardProject } from "@/lib/ai-video";
import { persistGeneratedProject } from "@/lib/project-mutations";
import { listProjects } from "@/lib/project-store";

const requestSchema = z.object({
  prompt: z.string().min(4),
  options: z.object({
    duration: z.enum(["15", "30", "45", "60"]),
    sceneCount: z.enum(["auto", "3", "5", "6"]),
    language: z.enum(["中文", "英文"]),
    style: z.enum(["电影质感", "极简高级", "明快有活力", "温暖自然"])
  }).optional(),
  baseProject: z.unknown().optional()
});

export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({ projects: await listProjects() });
}

function publicEngine(engine: string) {
  return engine === "heuristic" ? "heuristic" : "ai";
}

export async function POST(request: Request) {
  const body = requestSchema.parse(await request.json());
  const { project, engine } = await createStoryboardProject(body.prompt, undefined, body.options);
  const persisted = await persistGeneratedProject({
    prompt: body.prompt,
    project,
    engine
  });

  return NextResponse.json({ ...persisted, engine: publicEngine(engine) });
}
