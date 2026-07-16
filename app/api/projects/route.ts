import { NextResponse } from "next/server";
import { z } from "zod";
import { createStoryboardProject } from "@/lib/ai-video";
import { generateProjectSceneImages } from "@/lib/image-assets";
import { generateProjectVoices } from "@/lib/audio-assets";
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
  const sceneInstruction = body.options?.sceneCount && body.options.sceneCount !== "auto"
    ? `严格生成 ${body.options.sceneCount} 个场景。`
    : "场景数量由导演根据叙事自动规划。";
  const productionPrompt = body.options
    ? [
        body.prompt,
        `总时长严格为 ${body.options.duration} 秒。`,
        sceneInstruction,
        `全部标题、旁白和字幕使用${body.options.language}。`,
        `整体视觉风格为${body.options.style}。`
      ].join("\n")
    : body.prompt;
  const { project, engine } = await createStoryboardProject(productionPrompt);
  const projectWithImages = await generateProjectSceneImages(project);
  const projectWithMedia = await generateProjectVoices(projectWithImages);
  const persisted = await persistGeneratedProject({
    prompt: body.prompt,
    project: projectWithMedia,
    engine
  });

  return NextResponse.json({ ...persisted, engine: publicEngine(engine) });
}
