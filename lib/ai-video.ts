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

const treatmentSchema = z.object({
  workingTitle: z.string().min(1),
  language: z.string().min(1),
  audience: z.string().min(1),
  corePromise: z.string().min(1),
  creativeConcept: z.string().min(1),
  narrativeArc: z.string().min(1),
  visualBible: z.object({
    world: z.string().min(1),
    artDirection: z.string().min(1),
    palette: z.array(z.string()).min(3).max(6),
    lighting: z.string().min(1),
    cameraLanguage: z.string().min(1),
    recurringMotif: z.string().min(1),
    avoid: z.array(z.string()).min(2).max(10)
  }),
  beats: z.array(z.object({
    purpose: z.string().min(1),
    emotionalBeat: z.string().min(1),
    visualAnchor: z.string().min(1),
    transition: z.string().min(1)
  })).min(3).max(8)
});

type Treatment = z.infer<typeof treatmentSchema>;

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
        voiceover: z.string().optional(),
        thumbnailTone: z.string(),
        visualPrompt: z.string(),
        motionPrompt: z.string().optional()
      }),
      after: z.object({
        title: z.string(),
        voiceover: z.string().optional(),
        thumbnailTone: z.string(),
        visualPrompt: z.string(),
        motionPrompt: z.string().optional()
      }),
      regenerate: z.array(z.enum(["image", "audio", "clip", "thumbnail", "caption", "render"]))
    })
  )
});

type EditPlanPayload = z.infer<typeof editPlanPayloadSchema>;

function isGlobalChineseRewrite(request: string) {
  const wantsChinese = /中文|汉语|简体/u.test(request);
  const wantsGlobal = /所有|全部|全片|整体|都/u.test(request);
  return wantsChinese && wantsGlobal;
}

function isGlobalScopeRequest(request: string) {
  return /全片|整个视频|整支视频|所有场景|全部场景|每个场景|所有镜头|全部镜头|整体(?:风格|色调|节奏|画面|旁白|语言)?|都(?:改|换|调整|变成)|entire video|whole video|all scenes|every scene|throughout/iu.test(request);
}

function hasChinese(value?: string) {
  return Boolean(value && /\p{Script=Han}/u.test(value));
}

function validGlobalChinesePayload(payload: EditPlanPayload, version: ProjectVersion) {
  const changes = new Map(payload.changes.map((change) => [change.sceneNumber, change]));
  return version.scenes.every((scene) => {
    const after = changes.get(scene.sceneNumber)?.after;
    return after
      && hasChinese(after.title)
      && hasChinese(after.voiceover)
      && hasChinese(after.visualPrompt)
      && hasChinese(after.motionPrompt);
  });
}

function validGlobalScopePayload(payload: EditPlanPayload, version: ProjectVersion) {
  const affected = new Set(payload.affectedScenes);
  const changes = new Set(payload.changes.map((change) => change.sceneNumber));
  return version.scenes.every((scene) => affected.has(scene.sceneNumber) && changes.has(scene.sceneNumber));
}

const regenerateOrder = ["image", "audio", "clip", "thumbnail", "caption", "render"] as const;

function normalizedRegenerate(
  change: EditPlanPayload["changes"][number],
  scene: Scene,
  globalChineseRewrite: boolean
) {
  if (globalChineseRewrite) return ["image", "audio", "caption", "render"] as EditPlanPayload["changes"][number]["regenerate"];

  const regenerate = new Set(change.regenerate);
  const afterVoiceover = change.after.voiceover ?? scene.voiceover;
  const afterMotion = change.after.motionPrompt ?? scene.motionPrompt;
  if (afterVoiceover !== scene.voiceover) {
    regenerate.add("audio");
    regenerate.add("caption");
  }
  if (
    change.after.title !== scene.title
    || change.after.visualPrompt !== scene.visualPrompt
    || change.after.thumbnailTone !== (scene.style.theme.includes("light") ? "light" : "dark")
  ) {
    regenerate.add("image");
    regenerate.add("thumbnail");
  }
  if (afterMotion !== scene.motionPrompt || regenerate.size > 0) regenerate.add("render");
  return regenerateOrder.filter((type) => regenerate.has(type));
}

function normalizeEditPayload(
  payload: EditPlanPayload,
  version: ProjectVersion,
  globalChineseRewrite: boolean,
  globalScopeRequest: boolean
): EditPlanPayload {
  const sceneByNumber = new Map(version.scenes.map((scene) => [scene.sceneNumber, scene]));
  const seen = new Set<number>();
  const changes = payload.changes.flatMap((change) => {
    const scene = sceneByNumber.get(change.sceneNumber);
    if (!scene || seen.has(change.sceneNumber)) return [];
    seen.add(change.sceneNumber);
    return [{
      ...change,
      before: {
        title: scene.title,
        voiceover: scene.voiceover,
        thumbnailTone: scene.style.theme.includes("light") ? "light" : "dark",
        visualPrompt: scene.visualPrompt,
        motionPrompt: scene.motionPrompt
      },
      after: {
        ...change.after,
        voiceover: change.after.voiceover ?? scene.voiceover,
        motionPrompt: change.after.motionPrompt ?? scene.motionPrompt
      },
      regenerate: normalizedRegenerate(change, scene, globalChineseRewrite)
    }];
  });

  return globalChineseRewrite
    ? {
        ...payload,
        summary: `将全部 ${version.scenes.length} 个场景的标题、旁白、画面描述、镜头运动和字幕统一改为中文。`,
        affectedScenes: version.scenes.map((scene) => scene.sceneNumber),
        changes
      }
    : {
        ...payload,
        affectedScenes: globalScopeRequest
          ? version.scenes.map((scene) => scene.sceneNumber)
          : changes.map((change) => change.sceneNumber),
        changes
      };
}

function getTextModel() {
  const timeout = Math.min(30_000, Math.max(8_000, Number(process.env.AI_TEXT_TIMEOUT_MS) || 18_000));
  if (process.env.DEEPSEEK_API_KEY) {
    const configuredModel = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
    const model = configuredModel === "deepseek-v4-flash" ? configuredModel : "deepseek-v4-flash";

    return {
      client: new OpenAI({
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
        timeout,
        maxRetries: 0
      }),
      model,
      engine: "deepseek-flash" as const
    };
  }

  if (process.env.OPENAI_API_KEY) {
    return {
      client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout, maxRetries: 0 }),
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

function isModelConnectionError(error: unknown) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /timeout|timed out|connection|fetch failed|econn|etimedout|network/i.test(message);
}

function requestedDuration(prompt: string) {
  const match = prompt.match(/(?:时长|duration)?\s*(\d{1,3})\s*(?:秒|秒钟|seconds?|s\b)/i);
  const duration = match ? Number(match[1]) : 30;
  return Math.min(120, Math.max(15, duration));
}

function requestedSceneCount(prompt: string, targetDuration: number) {
  const match = prompt.match(/(?:分成|生成|需要|共|exactly)?\s*(\d)\s*(?:个)?(?:场景|镜头|分镜|scenes?|shots?)/i);
  const count = match ? Number(match[1]) : 5;
  const maximumFeasibleCount = Math.max(3, Math.floor(targetDuration / 3));
  return Math.min(8, maximumFeasibleCount, Math.max(3, count));
}

function distributeDurations(values: number[], target: number) {
  const source = values.map((value) => Math.max(3, value));
  const sourceTotal = source.reduce((sum, value) => sum + value, 0) || source.length;
  const scaled = source.map((value) => Math.max(3, Math.round((value / sourceTotal) * target)));
  let difference = target - scaled.reduce((sum, value) => sum + value, 0);
  let cursor = 0;

  while (difference !== 0 && cursor < 500) {
    const index = cursor % scaled.length;
    if (difference > 0) {
      scaled[index] += 1;
      difference -= 1;
    } else if (scaled[index] > 3) {
      scaled[index] -= 1;
      difference += 1;
    }
    cursor += 1;
  }

  return scaled;
}

function continuityDirection(treatment: Treatment) {
  const bible = treatment.visualBible;
  return [
    `Shared visual world: ${bible.world}`,
    `Art direction: ${bible.artDirection}`,
    `Lighting: ${bible.lighting}`,
    `Recurring motif: ${bible.recurringMotif}`,
    `Avoid: ${bible.avoid.join(", ")}`
  ].join(". ");
}

function normalizeStoryboard(
  parsed: z.infer<typeof storyboardSchema>,
  treatment: Treatment,
  targetDuration: number
) {
  const durations = distributeDurations(parsed.scenes.map((scene) => scene.durationSeconds), targetDuration);
  const continuity = continuityDirection(treatment);

  return parsed.scenes.map((scene, index): Scene => ({
    id: crypto.randomUUID(),
    sceneNumber: index + 1,
    title: scene.title.trim(),
    voiceover: scene.voiceover.trim(),
    visualPrompt: `${scene.visualPrompt.trim()}\n${continuity}`,
    motionPrompt: `${scene.motionPrompt.trim()} Camera language: ${treatment.visualBible.cameraLanguage}. Transition: ${treatment.beats[index]?.transition ?? "motivated visual match cut"}.`,
    durationSeconds: durations[index],
    style: {
      ...scene.style,
      palette: treatment.visualBible.palette
    },
    assets: []
  }));
}

function storyboardQualityIssues(scenes: Scene[]) {
  const issues: string[] = [];
  const normalizedTitles = scenes.map((scene) => scene.title.toLowerCase().replace(/\s+/g, " "));

  if (new Set(normalizedTitles).size !== normalizedTitles.length) issues.push("scene titles repeat");
  if (storyboardLooksGeneric(scenes)) issues.push("scene structure is generic");
  if (scenes.some((scene) => scene.visualPrompt.split("\n")[0].length < 100)) issues.push("visual direction lacks concrete detail");
  if (scenes.some((scene) => scene.motionPrompt.split(" Camera language:")[0].length < 50)) issues.push("camera or motion direction lacks detail");
  if (scenes.some((scene) => scene.voiceover.length < 12)) issues.push("voiceover is too short");

  return issues;
}

async function createTreatment(prompt: string, textModel: NonNullable<ReturnType<typeof getTextModel>>) {
  const targetDuration = requestedDuration(prompt);
  const sceneCount = requestedSceneCount(prompt, targetDuration);
  const completion = await textModel.client.chat.completions.create({
    model: textModel.model,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You are a senior commercial film director and creative strategist.",
          "Develop one coherent, specific treatment for an AI-generated short video.",
          "Find a visual concept rooted in the user's actual subject, not a software feature list.",
          "Each beat must advance one narrative arc and introduce a distinct visual event.",
          "Establish a reusable visual bible so separately generated shots still feel like one film.",
          "Prefer observable actions, environments, objects, transformations, and human stakes over dashboards or floating UI cards.",
          "Return strict JSON only. Do not mention model providers or internal production notes."
        ].join(" ")
      },
      {
        role: "user",
        content: `Creative request:\n${prompt}\n\nTarget duration: ${targetDuration} seconds. Required beats: exactly ${sceneCount}.\n\nReturn JSON in this exact shape:\n{ "workingTitle": string, "language": string, "audience": string, "corePromise": string, "creativeConcept": string, "narrativeArc": string, "visualBible": { "world": string, "artDirection": string, "palette": string[3-6], "lighting": string, "cameraLanguage": string, "recurringMotif": string, "avoid": string[2-10] }, "beats": [{ "purpose": string, "emotionalBeat": string, "visualAnchor": string, "transition": string }] }`
      }
    ],
    temperature: 0.6
  });

  const treatment = treatmentSchema.parse(extractJson(completion.choices[0]?.message.content ?? "{}"));
  if (treatment.beats.length !== sceneCount) {
    throw new Error(`Director treatment returned ${treatment.beats.length} beats; expected ${sceneCount}`);
  }
  return treatment;
}

async function repairStoryboard(params: {
  prompt: string;
  treatment: Treatment;
  storyboard: z.infer<typeof storyboardSchema>;
  issues: string[];
  targetDuration: number;
  textModel: NonNullable<ReturnType<typeof getTextModel>>;
}) {
  const completion = await params.textModel.client.chat.completions.create({
    model: params.textModel.model,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You are the final quality-control director for a commercial storyboard.",
          "Rewrite the storyboard to resolve every listed issue while preserving the approved treatment.",
          "Return strict JSON only, using the exact same storyboard schema.",
          "Use concrete filmable imagery, distinct shot purposes, natural narration, and coherent visual continuity.",
          "Do not explain the changes."
        ].join(" ")
      },
      {
        role: "user",
        content: `Original request:\n${params.prompt}\n\nApproved treatment:\n${JSON.stringify(params.treatment, null, 2)}\n\nRejected storyboard:\n${JSON.stringify(params.storyboard, null, 2)}\n\nQuality issues:\n- ${params.issues.join("\n- ")}\n\nRequirements: exactly ${params.treatment.beats.length} scenes and exactly ${params.targetDuration} total seconds. Every visualPrompt must be at least 120 characters and every motionPrompt at least 60 characters.\n\nJSON shape: { "title": string, "scenes": [{ "title": string, "voiceover": string, "visualPrompt": string, "motionPrompt": string, "durationSeconds": number, "style": { "theme": string, "palette": string[], "mood": string } }] }`
      }
    ],
    temperature: 0.35
  });

  const repaired = storyboardSchema.parse(extractJson(completion.choices[0]?.message.content ?? "{}"));
  if (repaired.scenes.length !== params.treatment.beats.length) {
    throw new Error(`Repaired storyboard returned ${repaired.scenes.length} scenes; expected ${params.treatment.beats.length}`);
  }
  return repaired;
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
    const targetDuration = requestedDuration(prompt);
    const treatment = await createTreatment(prompt, textModel);
    const completion = await textModel.client.chat.completions.create({
      model: textModel.model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            [
              "You are a meticulous storyboard director translating an approved treatment into production-ready shots.",
              "Return strict JSON only.",
              `Create exactly ${treatment.beats.length} scenes, one for each treatment beat, in the same order.`,
              `The complete video must last exactly ${targetDuration} seconds after integer rounding, with every scene at least 3 seconds.`,
              "The storyboard must play as a real short film, not a generic SaaS page outline or presentation.",
              "Never use generic section titles such as Customization, User Interface, Benefits, Features, Overview, or Conclusion.",
              "Every scene must have one unmistakable visual subject, a foreground action, an environment, depth, and a specific composition.",
              "Maintain the treatment's recurring motif, palette, world, lighting, and camera language across every scene.",
              "Do not rely on readable text, fake logos, generic dashboards, grids of floating cards, or instructions shown inside the image.",
              "Describe visual prompts as finished cinematic frames that an image model can render, not as design notes.",
              "Scene titles should be short, concrete, and in the same language as the user's request.",
              "Voiceover must be natural finished narration, fit comfortably in its scene duration, and avoid repeating the title.",
              "Motion prompts must specify camera movement, subject movement, depth behavior, and the handoff into the next shot."
            ].join(" ")
        },
        {
          role: "user",
          content: `Original request:\n${prompt}\n\nApproved director treatment:\n${JSON.stringify(treatment, null, 2)}\n\nReturn JSON in this exact shape:\n{ "title": string, "scenes": [{ "title": string, "voiceover": string, "visualPrompt": string, "motionPrompt": string, "durationSeconds": number, "style": { "theme": string, "palette": string[], "mood": string } }] }\n\nFor each visualPrompt include: the central subject and action, location/environment, foreground-midground-background composition, lens or framing, lighting, material/color details, and the treatment beat's visual anchor. Keep visual continuity without making shots visually repetitive.`
        }
      ],
      temperature: 0.5
    });

    const parsed = storyboardSchema.parse(extractJson(completion.choices[0]?.message.content ?? "{}"));
    if (parsed.scenes.length !== treatment.beats.length) {
      throw new Error(`Storyboard returned ${parsed.scenes.length} scenes; expected ${treatment.beats.length}`);
    }
    let acceptedStoryboard = parsed;
    let scenes = normalizeStoryboard(acceptedStoryboard, treatment, targetDuration);
    let qualityIssues = storyboardQualityIssues(scenes);
    if (qualityIssues.length > 0) {
      console.warn(`[ai-video] Storyboard quality check requested a repair: ${qualityIssues.join(", ")}.`);
      acceptedStoryboard = await repairStoryboard({
        prompt,
        treatment,
        storyboard: acceptedStoryboard,
        issues: qualityIssues,
        targetDuration,
        textModel
      });
      scenes = normalizeStoryboard(acceptedStoryboard, treatment, targetDuration);
      qualityIssues = storyboardQualityIssues(scenes);
      if (qualityIssues.length > 0) {
        console.error(`[ai-video] Repaired storyboard still failed quality checks (${qualityIssues.join(", ")}), using focused fallback.`);
        return { project: generateProjectFromPrompt(prompt, baseProject), engine: "heuristic" };
      }
    }

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
  const globalChineseRewrite = isGlobalChineseRewrite(params.request);
  const globalScopeRequest = globalChineseRewrite || isGlobalScopeRequest(params.request);
  const textModel = getTextModel();
  if (!textModel) {
    if (globalChineseRewrite) {
      throw new Error("全片中文转换需要文字改写服务，请稍后重试。");
    }
    return { editPlan: buildEditPlanFromRequest(params), engine: "heuristic" };
  }
  const activeTextModel = textModel;

  const globalDirective = globalChineseRewrite
    ? `\n\nThis is a GLOBAL Simplified Chinese localization. You MUST return one updated change for every scene. Every after.title, after.voiceover, after.visualPrompt, and after.motionPrompt must be written in Simplified Chinese. Do not limit visual translation to scenes that visibly contain text. affectedScenes must contain every scene number. regenerate must include audio, image, caption, and render.`
    : globalScopeRequest
      ? `\n\nThis is a GLOBAL edit request. You MUST return one updated change for every scene, preserve each scene's narrative purpose, and include every scene number in affectedScenes.`
      : "";

  async function requestPayload(retry = false) {
    const completion = await activeTextModel.client.chat.completions.create({
      model: activeTextModel.model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an AI video editor. Convert user instructions into a scene-level edit plan. Preserve unrelated scenes. When the user requests a language or narration change, rewrite title, voiceover, visualPrompt, and motionPrompt in the requested language and include the required regenerated assets. Return strict JSON only."
        },
        {
          role: "user",
          content: `Current version scenes:\n${JSON.stringify(params.version.scenes, null, 2)}\n\nUser edit request:\n${params.request}${globalDirective}${retry ? "\n\nYour previous attempt was incomplete. Rebuild the entire plan and satisfy every requirement above." : ""}\n\nJSON shape: { "summary": string, "affectedScenes": number[], "changes": [{ "sceneNumber": number, "status": "updated"|"added"|"deleted"|"unchanged", "before": { "title": string, "voiceover": string, "thumbnailTone": string, "visualPrompt": string, "motionPrompt": string }, "after": { "title": string, "voiceover": string, "thumbnailTone": string, "visualPrompt": string, "motionPrompt": string }, "regenerate": ("image"|"audio"|"clip"|"thumbnail"|"caption"|"render")[] }] }`
        }
      ],
      temperature: globalChineseRewrite ? 0.2 : 0.45
    });
    return editPlanPayloadSchema.parse(extractJson(completion.choices[0]?.message.content ?? "{}"));
  }

  try {
    let payload = await requestPayload();
    if (globalScopeRequest && !validGlobalScopePayload(payload, params.version)) {
      payload = await requestPayload(true);
    }
    if (globalScopeRequest && !validGlobalScopePayload(payload, params.version)) {
      throw new Error("Global edit plan did not cover every scene");
    }
    if (globalChineseRewrite && !validGlobalChinesePayload(payload, params.version)) {
      payload = await requestPayload(true);
    }
    if (globalChineseRewrite && !validGlobalChinesePayload(payload, params.version)) {
      throw new Error("Global Chinese edit plan did not cover every scene and field");
    }
    const normalized = normalizeEditPayload(payload, params.version, globalChineseRewrite, globalScopeRequest);
    return {
      engine: textModel.engine,
      editPlan: {
        id: crypto.randomUUID(),
        editNumber: params.editNumber,
        baseVersionId: params.version.id,
        status: "proposed",
        userRequest: params.request,
        summary: normalized.summary,
        affectedScenes: normalized.affectedScenes,
        changes: normalized.changes,
        createdAt: new Date().toISOString()
      }
    };
  } catch (error) {
    if (globalChineseRewrite) {
      console.error("[ai-video] Global Chinese edit plan failed validation:", error);
      if (isModelConnectionError(error)) {
        throw new Error("文字改写服务连接超时，请稍后重试。", { cause: error });
      }
      throw new Error("全片中文修改计划未通过完整性检查，请重试。", { cause: error });
    }
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
