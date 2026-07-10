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

const genericSceneNames = [
  "customization",
  "user interface",
  "overview",
  "features",
  "benefits",
  "conclusion",
  "introduction"
];

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

function storyboardLooksGeneric(scenes: Array<{ title: string; visualPrompt: string }>) {
  return scenes.some((scene) => {
    const title = scene.title.toLowerCase().trim();
    const visual = scene.visualPrompt.toLowerCase();
    return genericSceneNames.includes(title) || (
      genericSceneNames.some((name) => title.includes(name)) &&
      !visual.includes("video") &&
      !visual.includes("storyboard") &&
      !visual.includes("生成")
    );
  });
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
            [
              "You are a serious AI video director for a text-to-video product.",
              "Return strict JSON only.",
              "Create exactly 5 scenes unless the user explicitly asks for another count.",
              "The storyboard must be a real video narrative, not a generic SaaS page outline.",
              "Never use generic section titles such as Customization, User Interface, Benefits, Features, Overview, or Conclusion.",
              "Every scene must visually show concrete moments from the user's requested subject.",
              "If the subject is an AI video generation platform, the scenes should cover: request intake, AI storyboard planning, asset/video generation, conversational revision, and export/share.",
              "Scene titles should be short, concrete, and in the same language as the user's request.",
              "Voiceover should sound like finished narration, not internal notes.",
              "Visual prompts must describe what appears on screen, including UI objects, people/product context when useful, composition, and style.",
              "Motion prompts must describe camera movement and element animation."
            ].join(" ")
        },
        {
          role: "user",
          content: `User request:\n${prompt}\n\nReturn JSON in this exact shape:\n{ "title": string, "scenes": [{ "title": string, "voiceover": string, "visualPrompt": string, "motionPrompt": string, "durationSeconds": number, "style": { "theme": string, "palette": string[], "mood": string } }] }\n\nQuality bar:\n- Make each scene specific to the request.\n- Do not write generic software sections.\n- For a 30 second video, total duration should be close to 30 seconds.\n- The final video should feel like something a user could actually preview and approve.`
        }
      ],
      temperature: 0.45
    });

    const parsed = storyboardSchema.parse(extractJson(completion.choices[0]?.message.content ?? "{}"));
    if (storyboardLooksGeneric(parsed.scenes)) {
      console.error("[ai-video] Model returned generic storyboard, using focused heuristic fallback.");
      return { project: generateProjectFromPrompt(prompt, baseProject), engine: "heuristic" };
    }

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
