import { NextResponse } from "next/server";
import { z } from "zod";
import { createStoryboardProject } from "@/lib/ai-video";
import { persistGeneratedProject } from "@/lib/project-mutations";
import { listProjects } from "@/lib/project-store";

const requestSchema = z.object({
  prompt: z.string().trim().min(4).max(4000),
  options: z.object({
    duration: z.enum(["15", "30", "45", "60"]),
    sceneCount: z.enum(["auto", "3", "5", "6"]),
    language: z.enum(["中文", "英文"]),
    style: z.enum(["电影质感", "极简高级", "明快有活力", "温暖自然"])
  }).optional()
});

export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({ projects: await listProjects() });
}

function publicEngine(engine: string) {
  return engine === "heuristic" ? "heuristic" : "ai";
}

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const { project, engine } = await createStoryboardProject(body.prompt, undefined, body.options);
    const persisted = await persistGeneratedProject({
      prompt: body.prompt,
      project,
      engine
    });
    return NextResponse.json({ ...persisted, engine: publicEngine(engine) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "请用 4 到 4000 个字符描述要制作的视频，并检查时长、场景数、语言和风格选项。" },
        { status: 400 }
      );
    }
    console.error("[projects] Unable to create video project:", error);
    return NextResponse.json(
      { error: "视频项目没有完整保存，请稍后重试。本次失败不会留下半成品项目。" },
      { status: 502 }
    );
  }
}
