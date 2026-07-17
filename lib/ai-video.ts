import OpenAI from "openai";
import { z } from "zod";
import { analyzeEditIntent, requestsGeneratedClip } from "@/lib/edit-intent";
import { refineEditPlanScope } from "@/lib/edit-plan-refinement";
import { isProductionOnlyRequest, productionSettingsFromRequest } from "@/lib/production-edit-intent";
import { requestsSceneStructureChange, sceneStructureFromRequest, sceneStructureSummary } from "@/lib/scene-structure-intent";
import { buildEditPlanFromRequest, generateProjectFromPrompt } from "@/lib/video-brain";
import type { EditPlan, GenerationOptions, Project, ProjectVersion, Scene } from "@/lib/types";

type AiEngine = "deepseek-flash" | "openai" | "heuristic";

const sceneSchema = z.object({
  title: z.string().min(1),
  voiceover: z.string().min(1),
  visualPrompt: z.string().min(1),
  motionPrompt: z.string().min(1),
  durationSeconds: z.number().int().min(2).max(20),
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
        narrationVoice: z.enum(["male-clear", "male-deep", "female-natural"]).optional(),
        thumbnailTone: z.string(),
        visualPrompt: z.string(),
        motionPrompt: z.string().optional()
      }),
      after: z.object({
        title: z.string(),
        voiceover: z.string().optional(),
        narrationVoice: z.enum(["male-clear", "male-deep", "female-natural"]).optional(),
        thumbnailTone: z.string(),
        visualPrompt: z.string(),
        motionPrompt: z.string().optional()
      }),
      regenerate: z.array(z.enum(["image", "audio", "clip", "thumbnail", "caption", "render"]))
    })
  )
});

type EditPlanPayload = z.infer<typeof editPlanPayloadSchema>;

function hasChinese(value?: string) {
  return Boolean(value && /\p{Script=Han}/u.test(value));
}

function validGlobalChinesePayload(payload: EditPlanPayload, version: ProjectVersion) {
  const changes = new Map(payload.changes.map((change) => [change.sceneNumber, change]));
  return version.scenes.every((scene) => {
    const change = changes.get(scene.sceneNumber);
    const after = change?.after;
    return after
      && change.status === "updated"
      && hasChinese(after.title)
      && hasChinese(after.voiceover)
      && hasChinese(after.visualPrompt)
      && hasChinese(after.motionPrompt);
  });
}

function validGlobalScopePayload(payload: EditPlanPayload, version: ProjectVersion) {
  const affected = new Set(payload.affectedScenes);
  const changes = new Map(payload.changes.map((change) => [change.sceneNumber, change]));
  return version.scenes.every((scene) => (
    affected.has(scene.sceneNumber)
    && changes.get(scene.sceneNumber)?.status === "updated"
  ));
}

const regenerateOrder = ["image", "audio", "clip", "thumbnail", "caption", "render"] as const;

function normalizedRegenerate(
  change: EditPlanPayload["changes"][number],
  scene: Scene,
  globalChineseRewrite: boolean,
  preserveVisualAssetsOnLocalization: boolean
) {
  if (globalChineseRewrite && preserveVisualAssetsOnLocalization) {
    return ["audio", "caption", "render"] as EditPlanPayload["changes"][number]["regenerate"];
  }
  if (globalChineseRewrite) {
    return ["image", "audio", "thumbnail", "caption", "render"] as EditPlanPayload["changes"][number]["regenerate"];
  }

  const regenerate = new Set(change.regenerate);
  const afterVoiceover = change.after.voiceover ?? scene.voiceover;
  const afterVoice = change.after.narrationVoice ?? scene.style.narrationVoice;
  const afterMotion = change.after.motionPrompt ?? scene.motionPrompt;
  if (afterVoiceover !== scene.voiceover) {
    regenerate.add("audio");
    regenerate.add("caption");
  }
  if (afterVoice !== scene.style.narrationVoice) regenerate.add("audio");
  if (
    change.after.visualPrompt !== scene.visualPrompt
    || change.after.thumbnailTone !== (scene.style.theme.includes("light") ? "light" : "dark")
  ) {
    regenerate.add("image");
    regenerate.add("thumbnail");
  }
  if (change.after.title !== scene.title) regenerate.add("caption");
  if (afterMotion !== scene.motionPrompt || regenerate.size > 0) regenerate.add("render");
  return regenerateOrder.filter((type) => regenerate.has(type));
}

function normalizeEditPayload(
  payload: EditPlanPayload,
  version: ProjectVersion,
  userRequest: string,
  globalChineseRewrite: boolean,
  globalScopeRequest: boolean,
  preserveVisualAssetsOnLocalization: boolean,
  options?: {
    resolvedSceneNumbers?: Set<number>;
    preservePayloadScope?: boolean;
  }
): EditPlanPayload {
  const sceneByNumber = new Map(version.scenes.map((scene) => [scene.sceneNumber, scene]));
  const intent = analyzeEditIntent(
    userRequest,
    version.scenes.map((scene) => scene.sceneNumber)
  );
  const explicitlyAllowed = options?.resolvedSceneNumbers
    ?? (!globalScopeRequest && intent.explicitSceneNumbers.length > 0
      ? new Set(intent.explicitSceneNumbers)
      : undefined);
  const seen = new Set<number>();
  const changes = payload.changes.flatMap((change) => {
    const scene = sceneByNumber.get(change.sceneNumber);
    if (
      !scene
      || seen.has(change.sceneNumber)
      || (explicitlyAllowed && !explicitlyAllowed.has(change.sceneNumber))
      || change.status !== "updated"
    ) return [];
    seen.add(change.sceneNumber);
    return [{
      ...change,
      before: {
        title: scene.title,
        voiceover: scene.voiceover,
        narrationVoice: scene.style.narrationVoice,
        thumbnailTone: scene.style.theme.includes("light") ? "light" : "dark",
        visualPrompt: scene.visualPrompt,
        motionPrompt: scene.motionPrompt
      },
      after: {
        ...change.after,
        voiceover: change.after.voiceover ?? scene.voiceover,
        narrationVoice: change.after.narrationVoice ?? scene.style.narrationVoice,
        motionPrompt: change.after.motionPrompt ?? scene.motionPrompt
      },
      regenerate: normalizedRegenerate(
        change,
        scene,
        globalChineseRewrite,
        preserveVisualAssetsOnLocalization
      )
    }];
  });

  return globalChineseRewrite
    ? {
        ...payload,
        summary: options?.preservePayloadScope
          ? payload.summary
          : preserveVisualAssetsOnLocalization
            ? `将全部 ${version.scenes.length} 个场景的标题、旁白、字幕和制作描述统一改为中文，并保留现有视觉素材。`
            : `将全部 ${version.scenes.length} 个场景的标题、旁白、字幕和视觉方案统一改为中文。`,
        affectedScenes: options?.preservePayloadScope
          ? changes.map((change) => change.sceneNumber)
          : version.scenes.map((scene) => scene.sceneNumber),
        changes
      }
    : {
        ...payload,
        affectedScenes: globalScopeRequest && !options?.preservePayloadScope
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

function requestedDuration(prompt: string, options?: GenerationOptions) {
  if (options) return Number(options.duration);
  const match = prompt.match(/(?:时长|duration)?\s*(\d{1,3})\s*(?:秒|秒钟|seconds?|s\b)/i);
  const duration = match ? Number(match[1]) : 30;
  return Math.min(120, Math.max(15, duration));
}

function requestedSceneCount(prompt: string, targetDuration: number, options?: GenerationOptions) {
  if (options?.sceneCount && options.sceneCount !== "auto") return Number(options.sceneCount);
  const match = prompt.match(/(?:分成|生成|需要|共|exactly)?\s*(\d)\s*(?:个)?(?:场景|镜头|分镜|scenes?|shots?)/i);
  const count = match ? Number(match[1]) : 5;
  const maximumFeasibleCount = Math.max(3, Math.floor(targetDuration / 2));
  return Math.min(8, maximumFeasibleCount, Math.max(3, count));
}

function distributeDurations(values: number[], target: number) {
  const source = values.map((value) => Math.max(2, value));
  const sourceTotal = source.reduce((sum, value) => sum + value, 0) || source.length;
  const scaled = source.map((value) => Math.max(2, Math.round((value / sourceTotal) * target)));
  let difference = target - scaled.reduce((sum, value) => sum + value, 0);
  let cursor = 0;

  while (difference !== 0 && cursor < 500) {
    const index = cursor % scaled.length;
    if (difference > 0) {
      scaled[index] += 1;
      difference -= 1;
    } else if (scaled[index] > 2) {
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

function storyboardQualityIssues(
  scenes: Scene[],
  options?: GenerationOptions,
  projectTitle?: string
) {
  const issues: string[] = [];
  const normalizedTitles = scenes.map((scene) => scene.title.toLowerCase().replace(/\s+/g, " "));

  if (new Set(normalizedTitles).size !== normalizedTitles.length) issues.push("scene titles repeat");
  if (storyboardLooksGeneric(scenes)) issues.push("scene structure is generic");
  if (scenes.some((scene) => scene.visualPrompt.split("\n")[0].length < 100)) issues.push("visual direction lacks concrete detail");
  if (scenes.some((scene) => scene.motionPrompt.split(" Camera language:")[0].length < 50)) issues.push("camera or motion direction lacks detail");
  if (scenes.some((scene) => {
    const hanCharacters = (scene.voiceover.match(/\p{Script=Han}/gu) ?? []).length;
    const latinWords = (scene.voiceover.match(/[A-Za-z0-9]+/g) ?? []).length;
    return hanCharacters > 0
      ? hanCharacters < Math.max(4, Math.floor(scene.durationSeconds * 2.1))
      : latinWords < Math.max(3, Math.floor(scene.durationSeconds * 1.15));
  })) {
    issues.push("voiceover is too short for the available scene duration");
  }
  if (scenes.some((scene) => {
    const hanCharacters = (scene.voiceover.match(/\p{Script=Han}/gu) ?? []).length;
    const latinWords = (scene.voiceover.match(/[A-Za-z0-9]+/g) ?? []).length;
    const estimatedSeconds = hanCharacters / 4.15 + latinWords / 2.7;
    return estimatedSeconds > Math.max(1, scene.durationSeconds - 0.25) * 1.12;
  })) {
    issues.push("voiceover does not fit comfortably inside its scene duration");
  }
  if (options?.language === "中文" && scenes.some((scene) => !hasChinese(scene.title) || !hasChinese(scene.voiceover))) {
    issues.push("scene titles or narration are not fully localized in Chinese");
  }
  if (options?.language === "英文" && scenes.some((scene) => hasChinese(scene.title) || hasChinese(scene.voiceover))) {
    issues.push("scene titles or narration are not fully localized in English");
  }
  if (
    projectTitle
    && (
      (options?.language === "中文" && !hasChinese(projectTitle))
      || (options?.language === "英文" && hasChinese(projectTitle))
    )
  ) {
    issues.push("project title is not localized in the requested language");
  }

  return issues;
}

async function createTreatment(
  prompt: string,
  textModel: NonNullable<ReturnType<typeof getTextModel>>,
  options?: GenerationOptions
) {
  const targetDuration = requestedDuration(prompt, options);
  const sceneCount = requestedSceneCount(prompt, targetDuration, options);
  const languageDirection = options
    ? `Required language for workingTitle, all scene titles, narration, and visible text: ${options.language}.`
    : "Infer the language from the user's request.";
  const styleDirection = options
    ? `Required overall visual style: ${options.style}. Translate that style into a concrete visual bible rather than merely naming it.`
    : "Infer an appropriate visual style from the user's request.";
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
        content: `Creative request:\n${prompt}\n\nTarget duration: ${targetDuration} seconds. Required beats: exactly ${sceneCount}.\n${languageDirection}\n${styleDirection}\n\nReturn JSON in this exact shape:\n{ "workingTitle": string, "language": string, "audience": string, "corePromise": string, "creativeConcept": string, "narrativeArc": string, "visualBible": { "world": string, "artDirection": string, "palette": string[3-6], "lighting": string, "cameraLanguage": string, "recurringMotif": string, "avoid": string[2-10] }, "beats": [{ "purpose": string, "emotionalBeat": string, "visualAnchor": string, "transition": string }] }`
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
  options?: GenerationOptions;
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
        content: `Original request:\n${params.prompt}\n\nApproved treatment:\n${JSON.stringify(params.treatment, null, 2)}\n\nRejected storyboard:\n${JSON.stringify(params.storyboard, null, 2)}\n\nQuality issues:\n- ${params.issues.join("\n- ")}\n\nRequirements: exactly ${params.treatment.beats.length} scenes and exactly ${params.targetDuration} total seconds, with every scene at least 2 seconds. ${params.options ? `All titles and narration must use ${params.options.language}. The visual style must remain ${params.options.style}.` : ""} Every visualPrompt must be at least 120 characters and every motionPrompt at least 60 characters.\n\nJSON shape: { "title": string, "scenes": [{ "title": string, "voiceover": string, "visualPrompt": string, "motionPrompt": string, "durationSeconds": number, "style": { "theme": string, "palette": string[], "mood": string } }] }`
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

export async function createStoryboardProject(
  prompt: string,
  baseProject?: Project,
  options?: GenerationOptions
): Promise<{
  project: Project;
  engine: AiEngine;
}> {
  const textModel = getTextModel();
  if (!textModel) {
    return { project: generateProjectFromPrompt(prompt, baseProject, options), engine: "heuristic" };
  }

  try {
    const targetDuration = requestedDuration(prompt, options);
    const treatment = await createTreatment(prompt, textModel, options);
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
              `The complete video must last exactly ${targetDuration} seconds after integer rounding, with every scene at least 2 seconds.`,
              "The storyboard must play as a real short film, not a generic SaaS page outline or presentation.",
              "Never use generic section titles such as Customization, User Interface, Benefits, Features, Overview, or Conclusion.",
              "Every scene must have one unmistakable visual subject, a foreground action, an environment, depth, and a specific composition.",
              "Maintain the treatment's recurring motif, palette, world, lighting, and camera language across every scene.",
              "Do not rely on readable text, fake logos, generic dashboards, grids of floating cards, or instructions shown inside the image.",
              "Describe visual prompts as finished cinematic frames that an image model can render, not as design notes.",
              `Scene titles and narration must be short, concrete, and written in ${options?.language ?? treatment.language}.`,
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
    let qualityIssues = storyboardQualityIssues(scenes, options, acceptedStoryboard.title);
    if (qualityIssues.length > 0) {
      console.warn(`[ai-video] Storyboard quality check requested a repair: ${qualityIssues.join(", ")}.`);
      acceptedStoryboard = await repairStoryboard({
        prompt,
        treatment,
        storyboard: acceptedStoryboard,
        issues: qualityIssues,
        targetDuration,
        textModel,
        options
      });
      scenes = normalizeStoryboard(acceptedStoryboard, treatment, targetDuration);
      qualityIssues = storyboardQualityIssues(scenes, options, acceptedStoryboard.title);
      if (qualityIssues.length > 0) {
        console.error(`[ai-video] Repaired storyboard still failed quality checks (${qualityIssues.join(", ")}), using focused fallback.`);
        return { project: generateProjectFromPrompt(prompt, baseProject, options), engine: "heuristic" };
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
        title: acceptedStoryboard.title,
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
    return { project: generateProjectFromPrompt(prompt, baseProject, options), engine: "heuristic" };
  }
}

export async function createEditPlan(params: {
  request: string;
  version: ProjectVersion;
  editNumber: number;
}): Promise<{ editPlan: EditPlan; engine: AiEngine }> {
  const requestedProductionSettings = productionSettingsFromRequest(params.request);
  const requestedStructure = sceneStructureFromRequest(
    params.request,
    params.version.scenes.map((scene) => scene.sceneNumber)
  );
  if (requestsSceneStructureChange(params.request) && !requestedStructure) {
    throw new Error("请明确指定场景和操作，例如“拆分第 2 场景”“合并第 2 和第 3 场景”或“第 1 场景改成 6 秒”。");
  }
  if (requestedStructure) {
    const index = params.version.scenes.findIndex((scene) => scene.sceneNumber === requestedStructure.sceneNumber);
    if (requestedStructure.operation === "delete" && params.version.scenes.length <= 1) {
      throw new Error("视频至少需要保留一个场景。");
    }
    if (requestedStructure.operation === "move") {
      const atBoundary = requestedStructure.direction === "earlier"
        ? index === 0
        : index === params.version.scenes.length - 1;
      if (atBoundary) throw new Error("该场景已经位于时间线边界。");
    }
    if (requestedStructure.operation === "move-to" && requestedStructure.sceneNumber === requestedStructure.targetSceneNumber) {
      throw new Error("场景位置没有变化。");
    }
    if (requestedStructure.operation === "split") {
      const source = params.version.scenes[index];
      if (!source || source.durationSeconds < 4 || source.voiceover.trim().length < 8) {
        throw new Error("该场景内容过短，无法拆分为两个完整镜头。");
      }
      if (params.version.scenes.length >= 20) throw new Error("单个视频最多支持 20 个场景。");
    }
    if (requestedStructure.operation === "merge-next") {
      const source = params.version.scenes[index];
      const next = params.version.scenes[index + 1];
      if (!next) throw new Error("该场景没有后一场景可以合并。");
      if (source.durationSeconds + next.durationSeconds > 20) {
        throw new Error("合并后的场景超过 20 秒，请先缩短两个场景的时长。");
      }
    }
    const structureSummary = sceneStructureSummary(requestedStructure);
    return {
      engine: "heuristic",
      editPlan: {
        id: crypto.randomUUID(),
        editNumber: params.editNumber,
        baseVersionId: params.version.id,
        status: "proposed",
        userRequest: params.request,
        summary: Object.keys(requestedProductionSettings).length > 0
          ? `${structureSummary} 同时更新指定的全片设置。`
          : structureSummary,
        affectedScenes: requestedStructure.operation === "merge-next"
          ? [requestedStructure.sceneNumber, requestedStructure.sceneNumber + 1]
          : [requestedStructure.sceneNumber],
        changes: [],
        sceneStructure: requestedStructure,
        productionSettings: Object.keys(requestedProductionSettings).length > 0 ? requestedProductionSettings : undefined,
        createdAt: new Date().toISOString()
      }
    };
  }
  if (isProductionOnlyRequest(params.request)) {
    return { editPlan: buildEditPlanFromRequest(params), engine: "heuristic" };
  }
  const intent = analyzeEditIntent(
    params.request,
    params.version.scenes.map((scene) => scene.sceneNumber)
  );
  const globalChineseRewrite = intent.globalChineseRewrite;
  const globalScopeRequest = intent.global;
  const preserveVisualAssetsOnLocalization = intent.preserveVisualAssetsOnLocalization;
  const generatedClipRequest = requestsGeneratedClip(params.request);
  if (generatedClipRequest && intent.explicitSceneNumbers.length === 0 && !intent.global) {
    throw new Error("请指定要生成动态镜头的场景编号，例如“让第 2 场景动起来”；如需全部生成，请明确说“为全片生成动态镜头”。");
  }
  const textModel = getTextModel();
  if (!textModel) {
    if (globalChineseRewrite) {
      throw new Error("全片中文转换需要文字改写服务，请稍后重试。");
    }
    return { editPlan: buildEditPlanFromRequest(params), engine: "heuristic" };
  }
  const activeTextModel = textModel;

  const globalDirective = globalChineseRewrite
    ? `\n\nThis is a GLOBAL Simplified Chinese localization. You MUST return one updated change for every scene. Every after.title, after.voiceover, after.visualPrompt, and after.motionPrompt must be written in Simplified Chinese. Do not limit translation to scenes that visibly contain text. affectedScenes must contain every scene number. ${preserveVisualAssetsOnLocalization ? "This is translation-only: preserve the existing visual meaning and assets; regenerate must include audio, caption, and render, but must not include image, clip, or thumbnail." : "The request also changes visual direction; regenerate must include image, audio, thumbnail, caption, and render."}`
    : globalScopeRequest
      ? `\n\nThis is a GLOBAL edit request. You MUST return one updated change for every scene, preserve each scene's narrative purpose, and include every scene number in affectedScenes.`
      : "";
  const generatedClipDirective = generatedClipRequest
    ? "\n\nThis request asks for generated moving video clips. Preserve title, voiceover, narrationVoice, thumbnailTone, and visualPrompt exactly unless the user explicitly requests another change. You may refine motionPrompt to describe the desired physical movement. regenerate must include clip and render."
    : "";

  async function requestPayload(retry = false) {
    const completion = await activeTextModel.client.chat.completions.create({
      model: activeTextModel.model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an AI video editor. Convert user instructions into a scene-level edit plan. Preserve unrelated scenes. Never return changes for a scene outside an explicitly requested scene or range. Scene insertion and deletion are not supported in this editor, so every returned change must use status updated. A request without a specific scene target that changes language, narration, captions, style, palette, pacing, music, fonts, logos, watermarks, or voice applies to the full video. Supported narrationVoice values are male-clear for a clear energetic male voice, male-deep for a calm authoritative male voice, and female-natural for a warm natural female voice. Only change narrationVoice when the user asks for an audio voice or vocal character change. When the user requests a language or narration change, rewrite title, voiceover, visualPrompt, and motionPrompt in the requested language and include the required regenerated assets. A request to generate or animate a video clip is a media operation: preserve unrelated scene text and visual direction, and regenerate clip plus render. Return strict JSON only."
        },
        {
          role: "user",
          content: `Current version scenes:\n${JSON.stringify(params.version.scenes, null, 2)}\n\nUser edit request:\n${params.request}${globalDirective}${generatedClipDirective}${retry ? "\n\nYour previous attempt was incomplete. Rebuild the entire plan and satisfy every requirement above." : ""}\n\nJSON shape: { "summary": string, "affectedScenes": number[], "changes": [{ "sceneNumber": number, "status": "updated", "before": { "title": string, "voiceover": string, "narrationVoice"?: "male-clear"|"male-deep"|"female-natural", "thumbnailTone": string, "visualPrompt": string, "motionPrompt": string }, "after": { "title": string, "voiceover": string, "narrationVoice"?: "male-clear"|"male-deep"|"female-natural", "thumbnailTone": string, "visualPrompt": string, "motionPrompt": string }, "regenerate": ("image"|"audio"|"clip"|"thumbnail"|"caption"|"render")[] }] }`
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
    const normalized = normalizeEditPayload(
      payload,
      params.version,
      params.request,
      globalChineseRewrite,
      globalScopeRequest,
      preserveVisualAssetsOnLocalization
    );
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
        productionSettings: Object.keys(requestedProductionSettings).length > 0
          ? requestedProductionSettings
          : undefined,
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

export async function refineEditPlan(params: {
  request: string;
  version: ProjectVersion;
  existingPlan: EditPlan;
  editNumber: number;
}): Promise<{ editPlan: EditPlan; engine: AiEngine }> {
  if (params.existingPlan.baseVersionId !== params.version.id || params.existingPlan.status !== "proposed") {
    throw new Error("当前修改方案已经失效，请重新生成。");
  }

  const deterministic = refineEditPlanScope(params);
  if (deterministic) return { editPlan: deterministic, engine: "heuristic" };
  if (params.existingPlan.sceneStructure) {
    throw new Error("时间线结构方案暂不支持继续补充，请先取消，再用一句完整要求重新规划。");
  }

  const textModel = getTextModel();
  if (!textModel) {
    throw new Error("当前方案需要语义改写服务才能继续细化，请稍后重试。");
  }

  const available = new Set(params.version.scenes.map((scene) => scene.sceneNumber));
  const combinedRequest = `${params.existingPlan.userRequest}\n补充要求：${params.request}`;
  const combinedIntent = analyzeEditIntent(combinedRequest, Array.from(available));
  try {
    const completion = await textModel.client.chat.completions.create({
      model: textModel.model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You are a precise AI video edit-plan reviewer.",
            "Revise the existing proposed plan according to the user's follow-up instruction; do not apply it.",
            "The follow-up instruction has priority and may add, remove, or alter scene changes.",
            "Return the complete revised plan, not only the delta from the previous plan.",
            "Use only existing scene numbers and status updated. Preserve every unrelated field exactly.",
            "If a scene should remain unchanged, omit it from changes and affectedScenes.",
            "Keep all user-facing summary text in the user's language.",
            "Return strict JSON only."
          ].join(" ")
        },
        {
          role: "user",
          content: `Current scenes:\n${JSON.stringify(params.version.scenes, null, 2)}\n\nExisting proposed plan:\n${JSON.stringify(params.existingPlan, null, 2)}\n\nFollow-up instruction:\n${params.request}\n\nReturn JSON in this exact shape:\n{ "summary": string, "affectedScenes": number[], "changes": [{ "sceneNumber": number, "status": "updated", "before": { "title": string, "voiceover": string, "narrationVoice"?: "male-clear"|"male-deep"|"female-natural", "thumbnailTone": string, "visualPrompt": string, "motionPrompt": string }, "after": { "title": string, "voiceover": string, "narrationVoice"?: "male-clear"|"male-deep"|"female-natural", "thumbnailTone": string, "visualPrompt": string, "motionPrompt": string }, "regenerate": ("image"|"audio"|"clip"|"thumbnail"|"caption"|"render")[] }] }`
        }
      ],
      temperature: 0.2
    });
    const payload = editPlanPayloadSchema.parse(extractJson(completion.choices[0]?.message.content ?? "{}"));
    const seen = new Set<number>();
    for (const change of payload.changes) {
      if (!available.has(change.sceneNumber) || seen.has(change.sceneNumber) || change.status !== "updated") {
        throw new Error("Refined edit plan contains invalid or repeated scenes");
      }
      seen.add(change.sceneNumber);
    }
    if (payload.changes.length === 0 && !params.existingPlan.productionSettings) {
      throw new Error("Refined edit plan contains no changes");
    }

    const normalized = normalizeEditPayload(
      payload,
      params.version,
      combinedRequest,
      combinedIntent.globalChineseRewrite,
      combinedIntent.global,
      combinedIntent.preserveVisualAssetsOnLocalization,
      {
        resolvedSceneNumbers: new Set(payload.changes.map((change) => change.sceneNumber)),
        preservePayloadScope: true
      }
    );
    if (normalized.changes.length !== payload.changes.length) {
      throw new Error("Refined edit plan could not be normalized safely");
    }

    return {
      engine: textModel.engine,
      editPlan: {
        ...params.existingPlan,
        id: crypto.randomUUID(),
        editNumber: params.editNumber,
        userRequest: combinedRequest,
        summary: normalized.summary,
        affectedScenes: normalized.affectedScenes,
        changes: normalized.changes,
        status: "proposed",
        createdAt: new Date().toISOString()
      }
    };
  } catch (error) {
    console.error("[ai-video] Edit-plan refinement failed:", error);
    if (isModelConnectionError(error)) {
      throw new Error("方案细化服务连接超时，请稍后重试。", { cause: error });
    }
    throw new Error("没有可靠地理解这条补充要求，请说得更具体一些。", { cause: error });
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
