import OpenAI from "openai";
import { z } from "zod";
import { buildEditPlanFromRequest, generateProjectFromPrompt } from "@/lib/video-brain";
import type { EditPlan, Project, ProjectVersion, Scene } from "@/lib/types";

type AiEngine = "deepseek-flash" | "openai" | "heuristic";

const sceneSchema = z.object({
  title: z.string().min(1),
  voiceover: z.string().min(1),
  visualPrompt: z.string().min(1),
  motionPrompt: z.string().min(1),
  durationSeconds: z.number().int().min(3).max(20),
  style: z.object({
    theme: z.string().min(1),
    palette: z.array(z.string()).min(2).max(6),
    mood: z.string().min(1)
  })
});

const storyboardSchema = z.object({
  title: z.string().min(1),
  scenes: z.array(sceneSchema).min(3).max(8)
});

const editPlanPayloadSchema = z.object({
  summary: z.string().min(1),
  affectedScenes: z.array(z.number().int().positive()).min(1),
  changes: z.array(
    z.object({
      sceneNumber: z.number().int().positive(),
      status: z.enum(["updated", "added", "deleted", "unchanged"]),
      before: z.object({
        title: z.string(),
        thumbnailTone: z.string(),
        visualPrompt: z.string()
      }),
      after: z.object({
        title: z.string(),
        thumbnailTone: z.string(),
        visualPrompt: z.string()
      }),
      regenerate: z.array(z.enum(["image", "audio", "clip", "thumbnail", "caption", "render"]))
    })
  )
});

function getTextModel() {
  if (process.env.DEEPSEEK_API_KEY) {
    const configuredModel = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
    const model = configuredModel === "deepseek-v4-flash" ? configuredModel : "deepseek-v4-flash";

    return {
      client: new OpenAI({
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"
      }),
      model,
      engine: "deepseek-flash" as const
    };
  }

  if (process.env.OPENAI_API_KEY) {
    return {
      client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      engine: "openai" as const
    };
  }

  return undefined;
}

function getVisionModel() {
  if (!process.env.OPENAI_API_KEY) return undefined;
  return {
    client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
    model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini",
    engine: "openai" as const
  };
}

function extractJson(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse(fenced?.[1] ?? content);
}

export async function createStoryboardProject(prompt: string, baseProject?: Project): Promise<{
  project: Project;
  engine: AiEngine;
}> {
  const textModel = getTextModel();
  if (!textModel) {
    return { project: generateProjectFromPrompt(prompt, baseProject), engine: "heuristic" };
  }

  try {
    const completion = await textModel.client.chat.completions.create({
      model: textModel.model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a senior AI video director. Return strict JSON only. Create a concise 5-scene video storyboard with production-ready voiceover, visual prompts, motion prompts, durationSeconds, and style."
        },
        {
          role: "user",
          content: `Create a video storyboard for this request:\n${prompt}\n\nJSON shape: { "title": string, "scenes": [{ "title": string, "voiceover": string, "visualPrompt": string, "motionPrompt": string, "durationSeconds": number, "style": { "theme": string, "palette": string[], "mood": string } }] }`
        }
      ],
      temperature: 0.7
    });

    const parsed = storyboardSchema.parse(extractJson(completion.choices[0]?.message.content ?? "{}"));
    const scenes: Scene[] = parsed.scenes.map((scene, index) => ({
      id: crypto.randomUUID(),
      sceneNumber: index + 1,
      title: scene.title,
      voiceover: scene.voiceover,
      visualPrompt: scene.visualPrompt,
      motionPrompt: scene.motionPrompt,
      durationSeconds: scene.durationSeconds,
      style: scene.style,
      assets: []
    }));

    return {
      engine: textModel.engine,
      project: {
        ...(baseProject ?? {
          id: crypto.randomUUID(),
          engine: "Animation Engine",
          credits: 996,
          plan: "Free"
        }),
        title: parsed.title,
        currentVersion: {
          id: crypto.randomUUID(),
          label: "draft 1",
          status: "planning",
          createdAt: new Date().toISOString(),
          durationSeconds: scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0),
          scenes
        }
      }
    };
  } catch (error) {
    console.error("[ai-video] Falling back to heuristic storyboard:", error);
    return { project: generateProjectFromPrompt(prompt, baseProject), engine: "heuristic" };
  }
}

export async function createEditPlan(params: {
  request: string;
  version: ProjectVersion;
  editNumber: number;
}): Promise<{ editPlan: EditPlan; engine: AiEngine }> {
  const textModel = getTextModel();
  if (!textModel) {
    return { editPlan: buildEditPlanFromRequest(params), engine: "heuristic" };
  }

  try {
    const completion = await textModel.client.chat.completions.create({
      model: textModel.model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an AI video editor. Convert user instructions into a scene-level edit plan. Preserve unrelated scenes. Return strict JSON only."
        },
        {
          role: "user",
          content: `Current version scenes:\n${JSON.stringify(params.version.scenes, null, 2)}\n\nUser edit request:\n${params.request}\n\nJSON shape: { "summary": string, "affectedScenes": number[], "changes": [{ "sceneNumber": number, "status": "updated"|"added"|"deleted"|"unchanged", "before": { "title": string, "thumbnailTone": string, "visualPrompt": string }, "after": { "title": string, "thumbnailTone": string, "visualPrompt": string }, "regenerate": ("image"|"audio"|"clip"|"thumbnail"|"caption"|"render")[] }] }`
        }
      ],
      temperature: 0.45
    });

    const payload = editPlanPayloadSchema.parse(extractJson(completion.choices[0]?.message.content ?? "{}"));
    return {
      engine: textModel.engine,
      editPlan: {
        id: crypto.randomUUID(),
        editNumber: params.editNumber,
        baseVersionId: params.version.id,
        status: "proposed",
        userRequest: params.request,
        summary: payload.summary,
        affectedScenes: payload.affectedScenes,
        changes: payload.changes,
        createdAt: new Date().toISOString()
      }
    };
  } catch (error) {
    console.error("[ai-video] Falling back to heuristic edit plan:", error);
    return { editPlan: buildEditPlanFromRequest(params), engine: "heuristic" };
  }
}

export function describeAiRouting() {
  return {
    text: process.env.DEEPSEEK_API_KEY
      ? { provider: "deepseek", model: "deepseek-v4-flash" }
      : process.env.OPENAI_API_KEY
        ? { provider: "openai", model: process.env.OPENAI_MODEL || "gpt-4o-mini" }
        : { provider: "heuristic", model: "local-rules" },
    vision: getVisionModel()
      ? { provider: "openai", model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini" }
      : { provider: "not-configured", model: "none" }
  };
}
