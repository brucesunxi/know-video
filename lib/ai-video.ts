import OpenAI from "openai";
import { z } from "zod";
import { planningSceneSnapshot, versionAttachmentContext } from "@/lib/attachment-context";
import { analyzeEditIntent, globalEditTargetSceneNumbers, requestsGeneratedClip } from "@/lib/edit-intent";
import { refineEditPlanScope } from "@/lib/edit-plan-refinement";
import { isProductionOnlyRequest, productionSettingsFromRequest } from "@/lib/production-edit-intent";
import { fitScenesNarrationApproximate } from "@/lib/narration-fit";
import {
  detectBriefDomain,
  extractBriefVisualConcepts,
  hasMetaProductionNarration,
  isProductionInstructionClause
} from "@/lib/brief-semantics";
import { requestsSceneStructureChange, sceneStructureFromRequest, sceneStructureSummary } from "@/lib/scene-structure-intent";
import { storyboardQualityIssues } from "@/lib/storyboard-quality";
import { narrationVoiceForBrief } from "@/lib/voice-profiles";
import { buildEditPlanFromRequest, generateProjectFromPrompt } from "@/lib/video-brain";
import { looksSimplifiedChineseLocalized } from "@/lib/language-quality";
import { estimateNarrationSeconds } from "@/lib/speech-timing";
import { visualStyleDirection, visualStyleProfile } from "@/lib/visual-style-profiles";
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
  commercialBrief: z.object({
    subject: z.string().min(1),
    category: z.string().min(1),
    audience: z.string().min(1),
    customerProblem: z.string().min(1),
    offering: z.string().min(1),
    differentiators: z.array(z.string().min(1)).min(1).max(5),
    proofPoints: z.array(z.string().min(1)).max(4),
    outcomes: z.array(z.string().min(1)).min(1).max(4),
    callToAction: z.string().min(1)
  }),
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
    sourceFact: z.string().min(1),
    narrationLine: z.string().min(1),
    emotionalBeat: z.string().min(1),
    visualAnchor: z.string().min(1),
    transition: z.string().min(1)
  })).min(3).max(8)
});

type Treatment = z.infer<typeof treatmentSchema>;

function normalizedNarrationOpening(value: string) {
  const han = (value.match(/\p{Script=Han}/gu) ?? []).slice(0, 8).join("");
  if (han.length >= 6) return han;
  return (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).slice(0, 4).join(" ");
}

function compactNarrationToken(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。！？；,.!?;:：、\-_"'“”‘’()（）]/g, "");
}

function startsWithNarrationSubject(line: string, subject: string) {
  const normalizedSubject = compactNarrationToken(subject);
  if (normalizedSubject.length < 3) return false;
  if (["这项产品", "这个产品", "thisproduct", "theproduct"].includes(normalizedSubject)) return false;
  return compactNarrationToken(line).startsWith(normalizedSubject);
}

function repeatedSubjectOpenings(lines: string[], subject: string) {
  const repeated = lines.filter((line) => startsWithNarrationSubject(line, subject)).length;
  return repeated >= Math.min(2, Math.max(2, Math.ceil(lines.length * 0.35)));
}

function isChineseTreatment(treatment: Treatment) {
  return /中文|chinese|简体|普通话/i.test(treatment.language)
    || (treatment.beats.map((beat) => beat.narrationLine).join("").match(/\p{Script=Han}/gu) ?? []).length >= 8;
}

function compactClause(value: string, maxLength: number) {
  return value
    .replace(/\s+/g, " ")
    .replace(/^[\s,，。:：;；、-]+|[\s,，。:：;；、-]+$/g, "")
    .slice(0, maxLength)
    .trim();
}

function joinChineseParts(parts: string[], maxLength = 28) {
  const cleaned = parts.map((part) => compactClause(part, 34)).filter(Boolean);
  const kept: string[] = [];
  for (const part of cleaned) {
    const next = [...kept, part].join("，");
    if (next.length > maxLength) break;
    kept.push(part);
  }
  const joined = (kept.length > 0 ? kept : cleaned.slice(0, 1)).join("，");
  return compactClause(joined.replace(/，+/g, "，").replace(/，$/u, ""), maxLength) + "。";
}

function localNarrationLine(
  treatment: Treatment,
  beat: Treatment["beats"][number],
  index: number,
  averageSceneSeconds: number
) {
  const brief = treatment.commercialBrief;
  const domain = detectBriefDomain([
    brief.subject,
    brief.category,
    brief.audience,
    brief.customerProblem,
    brief.offering,
    ...brief.differentiators,
    ...brief.outcomes
  ].join(" "));
  const subject = compactClause(brief.subject, 12);
  const offering = compactClause(brief.offering, 14);
  const audience = compactClause(brief.audience, 10);
  const problem = compactClause(brief.customerProblem, 12);
  const differentiator = compactClause(brief.differentiators[index % brief.differentiators.length] ?? "", 12);
  const outcome = compactClause(brief.outcomes[index % brief.outcomes.length] ?? "", 12);
  const proof = compactClause(brief.proofPoints[index % Math.max(1, brief.proofPoints.length)] ?? "", 10);
  const sourceFact = compactClause(beat.sourceFact, 14);
  const chineseCharacterBudget = Math.max(12, Math.floor((averageSceneSeconds - 0.55) * 4));

  const chineseTemplates = domain === "gaming"
    ? [
        [`从${sourceFact || offering || "核心玩法"}开始`, `${subject || "这款游戏"}让玩家立即进入状态`],
        [`真正吸引人的`, `是${differentiator || offering || "每次操作都会得到清晰反馈"}`],
        [`随着${problem || "挑战"}展开`, "选择与行动不断改变局面"],
        [`每一次尝试`, `都带来${proof || outcome || "新的策略和发现"}`],
        [`完成目标之后`, `留下的是${outcome || "亲手赢得的成就感"}`],
        [`现在进入${subject || "游戏世界"}`, compactClause(brief.callToAction, 12) || "开始下一局"]
      ]
    : domain === "education"
      ? [
          [`从${problem || "学习难点"}出发`, `${subject || "这套课程"}先让知识变得容易理解`],
          [`关键方法是${sourceFact || offering || "把复杂内容拆成清晰步骤"}`, `帮助${audience || "学习者"}跟上节奏`],
          [`围绕${differentiator || "真实练习"}`, "理解与应用同步发生"],
          [`每一次反馈`, `都让${outcome || "学习进步"}更具体`],
          [`最终收获的是${outcome || "能够真正使用的知识"}`, compactClause(brief.callToAction, 12) || "继续探索"],
          [`下一步`, `让学习自然延伸到真实场景`]
        ]
      : domain === "commerce"
        ? [
            [`当${problem || "选择变得复杂"}`, `${subject || "这项服务"}先让商品价值清楚可见`],
            [`从${sourceFact || offering || "发现商品"}开始`, `体验一路保持顺畅`],
            [`围绕${differentiator || "真实需求"}`, "每个选择都更贴近消费者"],
            [`有了${proof || sourceFact || "可靠信息"}`, "下单决定更轻松"],
            [`最终抵达${outcome || "满意交付"}`, compactClause(brief.callToAction, 12) || "立即体验"],
            [`从看见到拥有`, "每一步都自然连贯"]
          ]
        : domain === "entertainment"
          ? [
              [`故事从${sourceFact || offering || "一个鲜明瞬间"}开始`, `${subject || "这项内容"}迅速建立情绪`],
              [`真正抓住注意力的`, `是${differentiator || "人物与冲突的变化"}`],
              [`随着${problem || "悬念"}展开`, "情绪与节奏持续推进"],
              [`每个关键瞬间`, `都留下${proof || outcome || "值得记住的感受"}`],
              [`最终抵达${outcome || "完整的情绪回响"}`, compactClause(brief.callToAction, 12) || "继续关注"],
              [`故事暂时落幕`, "期待已经指向下一次相遇"]
            ]
          : [
              [`面对${problem || "关键问题"}`, `${subject}先把问题变清楚`],
              [`关键变化来自${sourceFact || offering || "核心能力"}`, `形成${outcome || "可执行路径"}`],
              [`围绕${differentiator || offering || subject}`, "相关人员更快形成判断"],
              [`有了${proof || sourceFact || "清晰依据"}`, "每个决定都更可信"],
              [`最终交付的是${outcome || "稳定结果"}`, compactClause(brief.callToAction, 12) || "持续向前"],
              [`给${audience || "客户"}留下的`, `是更清楚的下一步`]
            ];
  if (isChineseTreatment(treatment)) {
    return joinChineseParts(
      chineseTemplates[index % chineseTemplates.length].filter(Boolean),
      chineseCharacterBudget
    );
  }

  const englishSubject = subject || "The product";
  const englishTemplates = domain === "gaming"
    ? [
        `From the first ${sourceFact || offering || "gameplay choice"}, ${englishSubject} puts players inside the action.`,
        `What makes it compelling is ${differentiator || offering || "immediate, readable feedback to every move"}.`,
        `As ${problem || "the challenge"} unfolds, each decision changes what happens next.`,
        `Every attempt reveals ${proof || outcome || "a new strategy, route, or discovery"}.`,
        `Reaching the goal delivers ${outcome || "the satisfaction of a result the player earned"}.`,
        `Enter ${englishSubject} and ${brief.callToAction || "start the next run"}.`
      ]
    : [
        `When ${brief.audience || "customers"} face ${problem || "a difficult problem"}, ${englishSubject} makes the next move clear.`,
        `The shift starts with ${sourceFact || offering || "the core experience"}, leading to ${outcome || "a clearer outcome"}.`,
        `Around ${differentiator || offering || englishSubject}, people understand what matters faster.`,
        `With ${proof || sourceFact || "a clearer basis for trust"}, each decision feels more grounded.`,
        `What customers receive is ${outcome || "a confident next step"}: ${brief.callToAction}.`,
        `The story closes with the next action visible and ready.`
      ];
  return englishTemplates[index % englishTemplates.length].replace(/\s+/g, " ").trim();
}

function shouldLocallyRepairNarrationLine(line: string, averageSceneSeconds: number, subject?: string) {
  const estimated = estimateNarrationSeconds(line);
  return hasMetaProductionNarration(line)
    || Boolean(subject && startsWithNarrationSubject(line, subject))
    || estimated < Math.max(1.35, averageSceneSeconds * 0.38)
    || estimated > Math.max(1.4, averageSceneSeconds * 1.12);
}

function locallyRepairTreatmentNarration(treatment: Treatment, targetDuration: number) {
  const averageSceneSeconds = targetDuration / treatment.beats.length;
  const totalSeconds = treatment.beats.reduce((sum, beat) => sum + estimateNarrationSeconds(beat.narrationLine), 0);
  const repairAll = totalSeconds < Math.max(4, targetDuration * 0.45)
    || totalSeconds > Math.max(3, targetDuration - treatment.beats.length * 0.28);
  const subject = treatment.commercialBrief.subject;
  let subjectOpeningAllowance = 1;
  return {
    ...treatment,
    beats: treatment.beats.map((beat, index) => {
      const line = beat.narrationLine.trim();
      const startsWithSubject = startsWithNarrationSubject(line, subject);
      const repairSubjectOpening = startsWithSubject && subjectOpeningAllowance <= 0;
      if (startsWithSubject && subjectOpeningAllowance > 0) subjectOpeningAllowance -= 1;
      if (!repairAll && !repairSubjectOpening && !shouldLocallyRepairNarrationLine(line, averageSceneSeconds)) return beat;
      return {
        ...beat,
        narrationLine: localNarrationLine(treatment, beat, index, averageSceneSeconds)
      };
    })
  };
}

function treatmentNarrationIssues(treatment: Treatment, targetDuration: number) {
  const lines = treatment.beats.map((beat) => beat.narrationLine.trim());
  const issues: string[] = [];
  const openings = lines.map(normalizedNarrationOpening).filter((value) => value.length >= 6);
  if (new Set(openings).size !== openings.length) issues.push("narration openings repeat mechanically");
  if (repeatedSubjectOpenings(lines, treatment.commercialBrief.subject)) {
    issues.push("narration starts with the product name too often");
  }
  if (lines.some(hasMetaProductionNarration)) {
    issues.push("narration describes video production instead of the client's business");
  }
  const estimatedTotal = lines.reduce((sum, line) => sum + estimateNarrationSeconds(line), 0);
  if (estimatedTotal < Math.max(4, targetDuration * 0.45)) {
    issues.push("locked narration is too sparse for the requested video duration");
  }
  if (estimatedTotal > Math.max(3, targetDuration - treatment.beats.length * 0.28)) {
    issues.push("locked narration exceeds the total spoken-time budget");
  }
  const requiredIntegerDuration = lines.reduce(
    (sum, line) => sum + Math.max(2, Math.ceil(estimateNarrationSeconds(line) + 0.45)),
    0
  );
  if (requiredIntegerDuration > targetDuration) {
    issues.push("locked narration cannot fit the requested integer scene durations without truncation");
  }
  const averageSceneSeconds = targetDuration / treatment.beats.length;
  if (lines.some((line) => estimateNarrationSeconds(line) < Math.max(1.35, averageSceneSeconds * 0.38))) {
    issues.push("one or more locked narration lines are too sparse to carry their scene");
  }
  if (lines.some((line) => estimateNarrationSeconds(line) > Math.max(1.4, averageSceneSeconds * 1.12))) {
    issues.push("one or more locked narration lines exceed their scene-level spoken-time budget");
  }
  const subject = treatment.commercialBrief.subject.trim().toLowerCase();
  if (isProductionInstructionClause(treatment.commercialBrief.subject)) {
    issues.push("commercial brief subject is a production instruction rather than the promoted company or product");
  }
  const narration = `${treatment.workingTitle} ${lines.join(" ")}`.toLowerCase();
  if (subject.length >= 2 && !narration.includes(subject)) {
    issues.push("locked narration loses the client's named company or product");
  }
  return issues;
}

function generationFallbackReason(error: unknown) {
  if (error instanceof z.ZodError) return "AI returned incomplete structured JSON";
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

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

function validGlobalChinesePayload(payload: EditPlanPayload, version: ProjectVersion, request: string) {
  const changes = new Map(payload.changes.map((change) => [change.sceneNumber, change]));
  const targets = new Set(globalEditTargetSceneNumbers(request, version.scenes.map((scene) => scene.sceneNumber)));
  return version.scenes.filter((scene) => targets.has(scene.sceneNumber)).every((scene) => {
    const change = changes.get(scene.sceneNumber);
    const after = change?.after;
    return after
      && change.status === "updated"
      && looksSimplifiedChineseLocalized(after.title)
      && looksSimplifiedChineseLocalized(after.voiceover)
      && looksSimplifiedChineseLocalized(after.visualPrompt)
      && looksSimplifiedChineseLocalized(after.motionPrompt);
  });
}

function validGlobalScopePayload(payload: EditPlanPayload, version: ProjectVersion, request: string) {
  const affected = new Set(payload.affectedScenes);
  const changes = new Map(payload.changes.map((change) => [change.sceneNumber, change]));
  const targets = new Set(globalEditTargetSceneNumbers(request, version.scenes.map((scene) => scene.sceneNumber)));
  return affected.size === targets.size
    && changes.size === targets.size
    && payload.changes.length === targets.size
    && Array.from(targets).every((sceneNumber) => (
      affected.has(sceneNumber)
      && changes.get(sceneNumber)?.status === "updated"
    ))
    && payload.affectedScenes.every((sceneNumber) => targets.has(sceneNumber))
    && payload.changes.every((change) => targets.has(change.sceneNumber));
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
  const globalTargets = globalEditTargetSceneNumbers(
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
            ? `将 ${globalTargets.length} 个目标场景的标题、旁白、字幕和制作描述统一改为中文，并保留现有视觉素材。`
            : `将 ${globalTargets.length} 个目标场景的标题、旁白、字幕和视觉方案统一改为中文。`,
        affectedScenes: options?.preservePayloadScope ? changes.map((change) => change.sceneNumber) : globalTargets,
        changes
      }
    : {
        ...payload,
        affectedScenes: globalScopeRequest && !options?.preservePayloadScope
          ? globalTargets
          : changes.map((change) => change.sceneNumber),
        changes
      };
}

function chineseLocalizationText(scene: Scene, field: "title" | "voiceover" | "visualPrompt" | "motionPrompt") {
  const number = scene.sceneNumber;
  if (field === "title") return `场景 ${number}：中文叙事重点`;
  if (field === "voiceover") return `第 ${number} 个场景使用自然中文旁白，延续原有叙事目的，清楚表达本段重点，并与整支视频的节奏保持一致。`;
  if (field === "visualPrompt") {
    return `第 ${number} 个场景的中文视觉方案：保留原有镜头目的和构图层级，画面主体清晰，背景干净，光线统一，色彩与整支视频一致，避免英文大段文字出现在画面中。`;
  }
  return `第 ${number} 个场景的中文镜头运动：保持原有节奏，使用平稳推进、轻微视差或自然转场，让画面重点逐步呈现，并与中文旁白同步。`;
}

function buildGlobalChineseFallbackPayload(
  version: ProjectVersion,
  request: string,
  preserveVisualAssetsOnLocalization: boolean
): EditPlanPayload {
  const targets = new Set(globalEditTargetSceneNumbers(request, version.scenes.map((scene) => scene.sceneNumber)));
  const scenes = version.scenes.filter((scene) => targets.has(scene.sceneNumber));
  return {
    summary: preserveVisualAssetsOnLocalization
      ? `将 ${scenes.length} 个目标场景的标题、旁白、字幕和制作描述统一改为中文，并保留现有视觉素材。`
      : `将 ${scenes.length} 个目标场景的标题、旁白、字幕和视觉方案统一改为中文。`,
    affectedScenes: scenes.map((scene) => scene.sceneNumber),
    changes: scenes.map((scene) => {
      const thumbnailTone = scene.style.theme.includes("light") ? "light" : "dark";
      return {
        sceneNumber: scene.sceneNumber,
        status: "updated" as const,
        before: {
          title: scene.title,
          voiceover: scene.voiceover,
          narrationVoice: scene.style.narrationVoice,
          thumbnailTone,
          visualPrompt: scene.visualPrompt,
          motionPrompt: scene.motionPrompt
        },
        after: {
          title: chineseLocalizationText(scene, "title"),
          voiceover: chineseLocalizationText(scene, "voiceover"),
          narrationVoice: scene.style.narrationVoice,
          thumbnailTone,
          visualPrompt: chineseLocalizationText(scene, "visualPrompt"),
          motionPrompt: chineseLocalizationText(scene, "motionPrompt")
        },
        regenerate: preserveVisualAssetsOnLocalization
          ? ["audio", "caption", "render"]
          : ["image", "audio", "thumbnail", "caption", "render"]
      };
    })
  };
}

function buildGlobalChineseFallbackEditPlan(params: {
  request: string;
  version: ProjectVersion;
  editNumber: number;
  productionSettings?: ReturnType<typeof productionSettingsFromRequest>;
  preserveVisualAssetsOnLocalization: boolean;
}): EditPlan {
  const payload = buildGlobalChineseFallbackPayload(
    params.version,
    params.request,
    params.preserveVisualAssetsOnLocalization
  );
  const normalized = normalizeEditPayload(
    payload,
    params.version,
    params.request,
    true,
    true,
    params.preserveVisualAssetsOnLocalization
  );
  return {
    id: crypto.randomUUID(),
    editNumber: params.editNumber,
    baseVersionId: params.version.id,
    status: "proposed",
    userRequest: params.request,
    summary: normalized.summary,
    affectedScenes: normalized.affectedScenes,
    changes: normalized.changes,
    productionSettings: params.productionSettings && Object.keys(params.productionSettings).length > 0
      ? params.productionSettings
      : undefined,
    createdAt: new Date().toISOString()
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

function approximateDurationRange(target: number) {
  return {
    minimum: Math.max(2, Math.round(target * 0.86)),
    maximum: Math.max(3, Math.round(target * 1.14))
  };
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

function briefVisualConceptDirection(prompt: string, options?: GenerationOptions) {
  const concepts = extractBriefVisualConcepts(prompt, options?.language !== "英文");
  if (concepts.length === 0) return "";
  if (detectBriefDomain(prompt) === "gaming") {
    return [
      `Brief-derived game anchors: ${concepts.join(", ")}.`,
      "Every scene must turn at least one anchor into visible gameplay: a player-controlled action, readable objective, character response, changing challenge, progression feedback, reward, or new route.",
      "Show the game world itself. Do not translate levels into enterprise gates, or use governance control rooms, approval paths, evidence packets, responsibility chains, dashboards, office meetings, or generic workflow diagrams."
    ].join(" ");
  }
  return [
    `Brief-derived visual anchors: ${concepts.join(", ")}.`,
    "Every scene should embody at least one anchor as a concrete object, environment, diagrammatic structure, workflow artifact, or human action.",
    "For gates, checkpoints, evidence, records, responsibility chains, approvals, or risk signals, use filmable spatial metaphors such as sequential portals, arrow paths, linked evidence packets, checkpoint tables, control-room routes, or traceable trails. Use icons, numbers, and short marks instead of long readable text."
  ].join(" ");
}

function normalizeStoryboard(
  parsed: z.infer<typeof storyboardSchema>,
  treatment: Treatment,
  targetDuration: number,
  prompt = "",
  options?: GenerationOptions
) {
  const continuity = continuityDirection(treatment);
  const conceptDirection = briefVisualConceptDirection(prompt, options);

  const scenes = parsed.scenes.map((scene, index): Scene => ({
    id: crypto.randomUUID(),
    sceneNumber: index + 1,
    title: scene.title.trim(),
    // The strategist owns the spoken story. The storyboard pass only designs how to film it.
    voiceover: treatment.beats[index]?.narrationLine.trim() || scene.voiceover.trim(),
    visualPrompt: `${scene.visualPrompt.trim()}\n${continuity}${conceptDirection ? `\n${conceptDirection}` : ""}`,
    motionPrompt: `${scene.motionPrompt.trim()} Camera language: ${treatment.visualBible.cameraLanguage}. Transition: ${treatment.beats[index]?.transition ?? "motivated visual match cut"}.`,
    durationSeconds: scene.durationSeconds,
    style: {
      ...scene.style,
      palette: treatment.visualBible.palette
    },
    assets: []
  }));
  return fitScenesNarrationApproximate(scenes, targetDuration);
}

function blockingStoryboardIssues(issues: string[]) {
  return issues.filter((issue) => (
    issue === "scene titles repeat"
    || issue === "scene structure is generic"
    || issue === "voiceover narrates the production instead of the client's company or product"
    || issue === "voiceover loses the client's named company or product"
    || issue === "voiceover starts with the product name too often"
    || issue === "voiceover conflicts with the client's industry"
    || issue === "game is framed as a product explainer"
    || issue === "voiceover does not fit comfortably inside its scene duration"
    || issue === "scene content is not fully localized in Chinese"
    || issue === "scene content is not fully localized in English"
    || issue === "project title is not localized in the requested language"
  ));
}

async function createTreatment(
  prompt: string,
  textModel: NonNullable<ReturnType<typeof getTextModel>>,
  options?: GenerationOptions,
  referenceContext = ""
) {
  const targetDuration = requestedDuration(prompt, options);
  const sceneCount = requestedSceneCount(prompt, targetDuration, options);
  const languageDirection = options
    ? `Required language for workingTitle, all scene titles, narration, and visible text: ${options.language}.`
    : "Infer the language from the user's request.";
  const styleDirection = options
    ? `Required overall visual style: ${options.style}. Use this exact style bible and make it visibly different from the other presets: ${visualStyleDirection(options.style)}`
    : "Infer an appropriate visual style from the user's request.";
  const averageSceneSeconds = targetDuration / sceneCount;
  const narrationBudgetDirection = options?.language === "英文"
    ? `Each narrationLine is final spoken copy: approximately ${Math.max(3, Math.floor(averageSceneSeconds * 1.15))}-${Math.max(4, Math.floor(averageSceneSeconds * 2.2))} English words.`
    : `Each narrationLine is final spoken copy: approximately ${Math.max(8, Math.floor(averageSceneSeconds * 2.9))}-${Math.max(12, Math.floor(averageSceneSeconds * 4.25))} Chinese characters, excluding punctuation.`;
  const conceptDirection = briefVisualConceptDirection(prompt, options);
  const domainDirection = detectBriefDomain(prompt) === "gaming"
    ? "This is a game trailer or gameplay introduction, not a product explainer. Write about the playable fantasy, player agency, core loop, challenge, progression, feedback, and invitation to play. Never frame the game as a business product, solution, platform, service, workflow, or efficiency tool."
    : "";
  const completion = await textModel.client.chat.completions.create({
    model: textModel.model,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You are a senior commercial film director and creative strategist.",
          "Develop one coherent, specific treatment for an AI-generated short video.",
          "First extract a commercialBrief from the client input. Identify the promoted subject, category, audience, customer problem, offering, differentiators, supplied proof, desired outcomes, and call to action.",
          "Infer the client's real industry before writing. Keep every concept inside that industry: a game should speak about players, gameplay, choices, challenge, feedback, progression, replay, and its stated features; never import enterprise pressure, governance, approval, evidence, workflow, or team-alignment language unless the client explicitly supplied it.",
          "Treat only facts stated or clearly implied by the client as facts. Never invent customers, metrics, awards, market claims, or product capabilities. Use an empty proofPoints array when no proof is supplied.",
          "Find a visual concept rooted in the user's actual subject, not a software feature list.",
          "Extract business structures from the client text and make them recurring visual motifs when present: gates, records, responsibility chains, evidence packets, approval paths, budget boundaries, risk signals, or scenario tables.",
          "Separate production instructions (make a video, duration, format, style, scenes) from the company or product being promoted.",
          "The spoken narrative must communicate the client's company, product, customer problem, differentiators, evidence, and outcome. It must never describe the act of making or watching this video unless video creation is itself the client's product.",
          "Mention the promoted subject naturally, but do not start multiple narrationLine values with the same product name or category. Vary openings across problem, action, proof, human change, and outcome.",
          "Each beat must advance one narrative arc and introduce a distinct visual event.",
          "Each beat must cite one sourceFact from commercialBrief and contain one narrationLine that is final, audience-facing spoken copy. It must not contain camera, scene, storyboard, generation, or production instructions.",
          "The final beat must resolve into a concrete delivery, outcome, or call-to-action moment.",
          "Establish a reusable visual bible so separately generated shots still feel like one film.",
          "Prefer observable actions, environments, objects, transformations, and human stakes over dashboards or floating UI cards.",
          "Return strict JSON only. Do not mention model providers or internal production notes."
        ].join(" ")
      },
      {
        role: "user",
        content: `Creative request:\n${prompt}${referenceContext ? `\n\n${referenceContext}` : ""}${conceptDirection ? `\n\n${conceptDirection}` : ""}${domainDirection ? `\n\nDomain directive: ${domainDirection}` : ""}\n\nTarget duration: ${targetDuration} seconds. Required beats: exactly ${sceneCount}.\n${languageDirection}\n${styleDirection}\n${narrationBudgetDirection}\n\nReturn JSON in this exact shape:\n{ "workingTitle": string, "language": string, "audience": string, "corePromise": string, "commercialBrief": { "subject": string, "category": string, "audience": string, "customerProblem": string, "offering": string, "differentiators": string[1-5], "proofPoints": string[0-4], "outcomes": string[1-4], "callToAction": string }, "creativeConcept": string, "narrativeArc": string, "visualBible": { "world": string, "artDirection": string, "palette": string[3-6], "lighting": string, "cameraLanguage": string, "recurringMotif": string, "avoid": string[2-10] }, "beats": [{ "purpose": string, "sourceFact": string, "narrationLine": string, "emotionalBeat": string, "visualAnchor": string, "transition": string }] }`
      }
    ],
    temperature: 0.6
  });

  let treatment = treatmentSchema.parse(extractJson(completion.choices[0]?.message.content ?? "{}"));
  if (options?.style) {
    const profile = visualStyleProfile(options.style);
    treatment = {
      ...treatment,
      visualBible: {
        ...treatment.visualBible,
        artDirection: `${profile.label}: ${profile.artDirection}. ${treatment.visualBible.artDirection}`,
        palette: profile.palette,
        lighting: profile.lighting,
        cameraLanguage: profile.cameraLanguage,
        avoid: Array.from(new Set([...treatment.visualBible.avoid, profile.avoid])).slice(0, 10)
      }
    };
  }
  if (treatment.beats.length !== sceneCount) {
    throw new Error(`Director treatment returned ${treatment.beats.length} beats; expected ${sceneCount}`);
  }
  treatment = locallyRepairTreatmentNarration(treatment, targetDuration);
  const narrationIssues = treatmentNarrationIssues(treatment, targetDuration);
  if (narrationIssues.length > 0) {
    const repair = await textModel.client.chat.completions.create({
      model: textModel.model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You are the commercial brief and narration quality editor.",
            "Repair the treatment while preserving every verified client fact and the required beat count.",
            "Separate production instructions from promoted-company content.",
            "Preserve the client's industry. Never rewrite a game, course, retail product, or entertainment property with unrelated enterprise-software language.",
            "Rewrite every narrationLine as concise, natural, audience-facing commercial narration grounded in its sourceFact.",
            "Do not start multiple narrationLine values with the same product name or category; vary the first phrase of every beat.",
            "Do not invent proof, metrics, customers, awards, or capabilities. Return strict JSON only."
          ].join(" ")
        },
        {
          role: "user",
          content: `Original client request:\n${prompt}${referenceContext ? `\n\n${referenceContext}` : ""}\n\nRejected treatment:\n${JSON.stringify(treatment, null, 2)}\n\nNarration issues:\n- ${narrationIssues.join("\n- ")}\n\nTarget duration: ${targetDuration} seconds. Required beats: exactly ${sceneCount}. ${languageDirection} ${narrationBudgetDirection}\n\nReturn the complete treatment with this exact shape:\n{ "workingTitle": string, "language": string, "audience": string, "corePromise": string, "commercialBrief": { "subject": string, "category": string, "audience": string, "customerProblem": string, "offering": string, "differentiators": string[1-5], "proofPoints": string[0-4], "outcomes": string[1-4], "callToAction": string }, "creativeConcept": string, "narrativeArc": string, "visualBible": { "world": string, "artDirection": string, "palette": string[3-6], "lighting": string, "cameraLanguage": string, "recurringMotif": string, "avoid": string[2-10] }, "beats": [{ "purpose": string, "sourceFact": string, "narrationLine": string, "emotionalBeat": string, "visualAnchor": string, "transition": string }] }`
        }
      ],
      temperature: 0.25
    });
    treatment = treatmentSchema.parse(extractJson(repair.choices[0]?.message.content ?? "{}"));
    treatment = locallyRepairTreatmentNarration(treatment, targetDuration);
    const remainingNarrationIssues = treatmentNarrationIssues(treatment, targetDuration);
    if (treatment.beats.length !== sceneCount || remainingNarrationIssues.length > 0) {
      console.warn(`[ai-video] Treatment narration still needed local constraints after AI repair: ${remainingNarrationIssues.join(", ") || "beat count mismatch"}.`);
    }
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
  referenceContext?: string;
}) {
  const conceptDirection = briefVisualConceptDirection(params.prompt, params.options);
  const durationRange = approximateDurationRange(params.targetDuration);
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
          "The approved treatment owns the spoken story. For scene N, copy treatment.beats[N-1].narrationLine into voiceover exactly; do not paraphrase, expand, or replace it.",
          "Narration must speak about the client's company or product, never about the video, scene, shot, camera, prompt, storyboard, or generation workflow unless that workflow is the actual product in the original request.",
          "If the original brief contains structures such as gates, evidence packets, responsibility chains, approval records, or risk signals, make them visible as concrete objects, paths, portals, arrows, maps, linked packets, or control-room artifacts.",
          "Across four or more scenes, use at least three clearly named shot scales or camera angles.",
          "Do not reuse the same narration opening, composition, or visual event in multiple scenes.",
          "The final scene must clearly feel like completion, delivery, launch, export, share, or the next action.",
          "Do not explain the changes."
        ].join(" ")
      },
      {
        role: "user",
        content: `Original request:\n${params.prompt}${params.referenceContext ? `\n\n${params.referenceContext}` : ""}${conceptDirection ? `\n\n${conceptDirection}` : ""}\n\nApproved treatment:\n${JSON.stringify(params.treatment, null, 2)}\n\nRejected storyboard:\n${JSON.stringify(params.storyboard, null, 2)}\n\nQuality issues:\n- ${params.issues.join("\n- ")}\n\nRequirements: exactly ${params.treatment.beats.length} scenes and an approximate total duration of ${params.targetDuration} seconds, naturally landing between ${durationRange.minimum} and ${durationRange.maximum} seconds, with every scene at least 2 seconds. Copy each treatment beat's narrationLine into the matching scene voiceover exactly. ${params.options ? `The project title and every scene title, voiceover, visualPrompt, motionPrompt, style.theme, and style.mood must use ${params.options.language}. The visual style must remain ${params.options.style}.` : ""} Every visualPrompt must be at least 120 characters and every motionPrompt at least 60 characters. Across four or more scenes, explicitly use at least three different shot scales or camera angles. Give every scene a different composition and visual event. If brief-derived visual anchors are provided, each scene must include at least one anchor as a concrete visible motif or workflow object. The last scene must resolve the film with a concrete completion, delivery, launch, export, share, or next-action moment.\n\nJSON shape: { "title": string, "scenes": [{ "title": string, "voiceover": string, "visualPrompt": string, "motionPrompt": string, "durationSeconds": number, "style": { "theme": string, "palette": string[], "mood": string } }] }`
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

export async function createStoryboardProject(
  prompt: string,
  baseProject?: Project,
  options?: GenerationOptions,
  referenceContext = ""
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
    const durationRange = approximateDurationRange(targetDuration);
    const treatment = await createTreatment(prompt, textModel, options, referenceContext);
    const conceptDirection = briefVisualConceptDirection(prompt, options);
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
              `Treat ${targetDuration} seconds as an approximate pacing target. Let the complete video land naturally between ${durationRange.minimum} and ${durationRange.maximum} seconds, with every scene at least 2 seconds.`,
              "The storyboard must play as a real short film, not a generic SaaS page outline or presentation.",
              "Never use generic section titles such as Customization, User Interface, Benefits, Features, Overview, or Conclusion.",
              "Every scene must have one unmistakable visual subject, a foreground action, an environment, depth, and a specific composition.",
              "The user's product text may contain business structures such as gates, evidence packets, responsibility chains, approval records, or risk signals. Translate those structures into specific visual objects and spatial systems rather than generic attractive imagery.",
              "Across four or more scenes, explicitly use at least three different shot scales or camera angles, such as macro, close-up, medium, wide, overhead, or low angle.",
              "Maintain the treatment's recurring motif, palette, world, lighting, and camera language across every scene.",
              "Do not rely on readable text, fake logos, generic dashboards, grids of floating cards, or instructions shown inside the image.",
              "Describe visual prompts as finished cinematic frames that an image model can render, not as design notes.",
              `The project title and every scene title, voiceover, visualPrompt, motionPrompt, style.theme, and style.mood must be written in ${options?.language ?? treatment.language}.`,
              "Voiceover must be natural finished narration, fit comfortably in its scene duration, and avoid repeating the title.",
              "The approved treatment owns the spoken story. For scene N, copy treatment.beats[N-1].narrationLine into voiceover exactly; do not paraphrase, expand, or replace it.",
              "Treat requests such as 'make a video', duration, style, format, and scene count only as production instructions, never as the subject of the narration.",
              "Voiceover must sell or explain the client's actual company, product, customer problem, differentiators, evidence, and outcome. Never narrate what the video, scene, shot, camera, storyboard, viewer, or generation process is doing unless video creation is itself the client's product.",
              "Keep all narration and visuals in the client's actual industry. For games, use the supplied gameplay, player action, world, challenge, progression, feedback, and replay value; never substitute enterprise pressure, governance, approvals, evidence packets, responsibility chains, or generic team workflow.",
              "Every scene must begin its narration differently and depict a different visual event and composition.",
              "The final scene must unmistakably resolve the promise with a deliverable outcome or clear next action, not just another feature beat.",
              "Motion prompts must specify camera movement, subject movement, depth behavior, and the handoff into the next shot."
            ].join(" ")
        },
        {
          role: "user",
          content: `Original request:\n${prompt}${referenceContext ? `\n\n${referenceContext}` : ""}${conceptDirection ? `\n\n${conceptDirection}` : ""}\n\nApproved director treatment:\n${JSON.stringify(treatment, null, 2)}\n\nReturn JSON in this exact shape:\n{ "title": string, "scenes": [{ "title": string, "voiceover": string, "visualPrompt": string, "motionPrompt": string, "durationSeconds": number, "style": { "theme": string, "palette": string[], "mood": string } }] }\n\nFor each visualPrompt include: the central subject and action, location/environment, foreground-midground-background composition, lens or framing, lighting, material/color details, and the treatment beat's visual anchor. The visualPrompt must include a concrete object or spatial metaphor from the brief-derived anchors when anchors are provided. Keep visual continuity without making shots visually repetitive. The final scene must be a resolved delivery, launch, export, share, or next-action moment that can function as a strong ending.`
        }
      ],
      temperature: 0.5
    });

    const parsed = storyboardSchema.parse(extractJson(completion.choices[0]?.message.content ?? "{}"));
    if (parsed.scenes.length !== treatment.beats.length) {
      throw new Error(`Storyboard returned ${parsed.scenes.length} scenes; expected ${treatment.beats.length}`);
    }
    let acceptedStoryboard = parsed;
    let scenes = normalizeStoryboard(acceptedStoryboard, treatment, targetDuration, prompt, options);
    let qualityIssues = storyboardQualityIssues(scenes, options, acceptedStoryboard.title, prompt);
    const initialRepairIssues = qualityIssues.filter((issue) => issue !== "voiceover is too sparse for the scene duration");
    if (initialRepairIssues.length > 0) {
      console.warn(`[ai-video] Storyboard quality check requested a repair: ${initialRepairIssues.join(", ")}.`);
      acceptedStoryboard = await repairStoryboard({
        prompt,
        treatment,
        storyboard: acceptedStoryboard,
        issues: initialRepairIssues,
        targetDuration,
        textModel,
        options,
        referenceContext
      });
      scenes = normalizeStoryboard(acceptedStoryboard, treatment, targetDuration, prompt, options);
      qualityIssues = storyboardQualityIssues(scenes, options, acceptedStoryboard.title, prompt);
      if (qualityIssues.length > 0) {
        const blockingIssues = blockingStoryboardIssues(qualityIssues);
        if (blockingIssues.length > 0) {
          throw new Error(`Repaired storyboard failed quality checks: ${blockingIssues.join(", ")}`);
        }
        console.warn(`[ai-video] Accepting repaired storyboard with non-blocking quality warnings: ${qualityIssues.join(", ")}.`);
      }
    } else if (qualityIssues.length > 0) {
      console.warn(`[ai-video] Accepting storyboard with natural narration breathing room: ${qualityIssues.join(", ")}.`);
    }

    const narrationVoice = narrationVoiceForBrief(prompt);
    scenes = scenes.map((scene) => ({
      ...scene,
      style: { ...scene.style, narrationVoice }
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
    console.error("[ai-video] Commercial brief or storyboard generation failed:", error);
    console.warn(`[ai-video] Using local storyboard fallback after generation failure: ${generationFallbackReason(error)}.`);
    return { project: generateProjectFromPrompt(prompt, baseProject, options), engine: "heuristic" };
  }
}

export async function createEditPlan(params: {
  request: string;
  version: ProjectVersion;
  editNumber: number;
  requestAttachmentContext?: string;
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
      return {
        editPlan: buildGlobalChineseFallbackEditPlan({
          request: params.request,
          version: params.version,
          editNumber: params.editNumber,
          productionSettings: requestedProductionSettings,
          preserveVisualAssetsOnLocalization
        }),
        engine: "heuristic"
      };
    }
    return { editPlan: buildEditPlanFromRequest(params), engine: "heuristic" };
  }
  const activeTextModel = textModel;
  const attachmentContext = [versionAttachmentContext(params.version), params.requestAttachmentContext]
    .filter(Boolean)
    .join("\n\n");
  const currentScenes = planningSceneSnapshot(params.version);

  const globalDirective = globalChineseRewrite
    ? `\n\nThis is a GLOBAL Simplified Chinese localization. The exact target scenes are ${globalEditTargetSceneNumbers(params.request, params.version.scenes.map((scene) => scene.sceneNumber)).join(", ")}. You MUST return one updated change for every target scene and no excluded scene. Every after.title, after.voiceover, after.visualPrompt, and after.motionPrompt must be written in Simplified Chinese. affectedScenes must exactly match the target scenes. ${preserveVisualAssetsOnLocalization ? "This is translation-only: preserve the existing visual meaning and assets; regenerate must include audio, caption, and render, but must not include image, clip, or thumbnail." : "The request also changes visual direction; regenerate must include image, audio, thumbnail, caption, and render."}`
    : globalScopeRequest
      ? `\n\nThis is a GLOBAL edit request. The exact target scenes are ${globalEditTargetSceneNumbers(params.request, params.version.scenes.map((scene) => scene.sceneNumber)).join(", ")}. You MUST return one updated change for every target scene and no excluded scene, preserve each target scene's narrative purpose, and make affectedScenes exactly match the target scenes.`
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
            "You are an AI video editor. Convert user instructions into a scene-level edit plan. Preserve unrelated scenes. Never return changes for a scene outside an explicitly requested scene or range. Scene insertion and deletion are not supported in this editor, so every returned change must use status updated. A request without a specific scene target that changes language, narration, captions, style, palette, pacing, music, fonts, logos, watermarks, or voice applies to the full video. Supported narrationVoice values are male-clear for a clear energetic male voice, male-deep for a calm authoritative male voice, and female-natural for a warm natural female voice. Only change narrationVoice when the user asks for an audio voice or vocal character change. When the user requests a language or narration change, rewrite title, voiceover, visualPrompt, and motionPrompt in the requested language and include the required regenerated assets. A request to generate or animate a video clip is a media operation: preserve unrelated scene text and visual direction, and regenerate clip plus render. User-uploaded attachments are authoritative source material: preserve their product, person, brand, composition, narration, or music identity unless the user explicitly asks to replace that attachment. If a requested visual transformation requires regeneration, describe the attachment identity that must remain in after.visualPrompt. Return strict JSON only."
        },
        {
          role: "user",
          content: `Current version scenes:\n${JSON.stringify(currentScenes, null, 2)}${attachmentContext ? `\n\n${attachmentContext}` : ""}\n\nUser edit request:\n${params.request}${globalDirective}${generatedClipDirective}${retry ? "\n\nYour previous attempt was incomplete. Rebuild the entire plan and satisfy every requirement above." : ""}\n\nJSON shape: { "summary": string, "affectedScenes": number[], "changes": [{ "sceneNumber": number, "status": "updated", "before": { "title": string, "voiceover": string, "narrationVoice"?: "male-clear"|"male-deep"|"female-natural", "thumbnailTone": string, "visualPrompt": string, "motionPrompt": string }, "after": { "title": string, "voiceover": string, "narrationVoice"?: "male-clear"|"male-deep"|"female-natural", "thumbnailTone": string, "visualPrompt": string, "motionPrompt": string }, "regenerate": ("image"|"audio"|"clip"|"thumbnail"|"caption"|"render")[] }] }`
        }
      ],
      temperature: globalChineseRewrite ? 0.2 : 0.45
    });
    return editPlanPayloadSchema.parse(extractJson(completion.choices[0]?.message.content ?? "{}"));
  }

  try {
    let payload = await requestPayload();
    if (globalScopeRequest && !validGlobalScopePayload(payload, params.version, params.request)) {
      payload = await requestPayload(true);
    }
    if (globalScopeRequest && !validGlobalScopePayload(payload, params.version, params.request)) {
      throw new Error("Global edit plan did not cover every scene");
    }
    if (globalChineseRewrite && !validGlobalChinesePayload(payload, params.version, params.request)) {
      payload = await requestPayload(true);
    }
    if (globalChineseRewrite && !validGlobalChinesePayload(payload, params.version, params.request)) {
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
      return {
        editPlan: buildGlobalChineseFallbackEditPlan({
          request: params.request,
          version: params.version,
          editNumber: params.editNumber,
          productionSettings: requestedProductionSettings,
          preserveVisualAssetsOnLocalization
        }),
        engine: "heuristic"
      };
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
  requestAttachmentContext?: string;
}): Promise<{ editPlan: EditPlan; engine: AiEngine }> {
  if (params.existingPlan.baseVersionId !== params.version.id || params.existingPlan.status !== "proposed") {
    throw new Error("当前修改方案已经失效，请重新生成。");
  }

  const requestedProductionSettings = productionSettingsFromRequest(params.request);
  if (isProductionOnlyRequest(params.request)) {
    return {
      engine: "heuristic",
      editPlan: {
        ...params.existingPlan,
        id: crypto.randomUUID(),
        editNumber: params.editNumber,
        userRequest: `${params.existingPlan.userRequest}\n补充要求：${params.request}`,
        summary: `保留当前修改方案，并补充更新全片播放与品牌设置：${params.request}`,
        productionSettings: {
          ...params.existingPlan.productionSettings,
          ...requestedProductionSettings
        },
        status: "proposed",
        createdAt: new Date().toISOString()
      }
    };
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
  const activeTextModel = textModel;

  const available = new Set(params.version.scenes.map((scene) => scene.sceneNumber));
  const attachmentContext = [versionAttachmentContext(params.version), params.requestAttachmentContext]
    .filter(Boolean)
    .join("\n\n");
  const currentScenes = planningSceneSnapshot(params.version);
  const combinedRequest = `${params.existingPlan.userRequest}\n补充要求：${params.request}`;
  const combinedIntent = analyzeEditIntent(combinedRequest, Array.from(available));
  const combinedTargets = globalEditTargetSceneNumbers(combinedRequest, Array.from(available));
  const refinementDirective = combinedIntent.globalChineseRewrite
    ? `\n\nThe combined request is a GLOBAL Simplified Chinese localization. The exact target scenes are ${combinedTargets.join(", ")}. Return one updated change for every target scene and no excluded scene. Every after.title, after.voiceover, after.visualPrompt, and after.motionPrompt must be written in Simplified Chinese. affectedScenes must exactly match the targets.`
    : combinedIntent.global
      ? `\n\nThe combined request is GLOBAL. The exact target scenes are ${combinedTargets.join(", ")}. Return one updated change for every target scene and no excluded scene. affectedScenes must exactly match the targets.`
      : "";
  try {
    async function requestRefinedPayload(retry = false) {
      const completion = await activeTextModel.client.chat.completions.create({
        model: activeTextModel.model,
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
              "Treat user-uploaded attachments as authoritative source material. Preserve them unless the follow-up explicitly requests replacement; if regenerating a visual, carry the attachment identity into after.visualPrompt.",
              "If a scene should remain unchanged, omit it from changes and affectedScenes.",
              "Keep all user-facing summary text in the user's language.",
              "Return strict JSON only."
            ].join(" ")
          },
          {
            role: "user",
            content: `Current scenes:\n${JSON.stringify(currentScenes, null, 2)}${attachmentContext ? `\n\n${attachmentContext}` : ""}\n\nExisting proposed plan:\n${JSON.stringify(params.existingPlan, null, 2)}\n\nFollow-up instruction:\n${params.request}${refinementDirective}${retry ? "\n\nThe previous response failed scope or language validation. Rebuild the complete plan exactly as directed." : ""}\n\nReturn JSON in this exact shape:\n{ "summary": string, "affectedScenes": number[], "changes": [{ "sceneNumber": number, "status": "updated", "before": { "title": string, "voiceover": string, "narrationVoice"?: "male-clear"|"male-deep"|"female-natural", "thumbnailTone": string, "visualPrompt": string, "motionPrompt": string }, "after": { "title": string, "voiceover": string, "narrationVoice"?: "male-clear"|"male-deep"|"female-natural", "thumbnailTone": string, "visualPrompt": string, "motionPrompt": string }, "regenerate": ("image"|"audio"|"clip"|"thumbnail"|"caption"|"render")[] }] }`
          }
        ],
        temperature: 0.2
      });
      return editPlanPayloadSchema.parse(extractJson(completion.choices[0]?.message.content ?? "{}"));
    }
    let payload = await requestRefinedPayload();
    if (combinedIntent.global && !validGlobalScopePayload(payload, params.version, combinedRequest)) {
      payload = await requestRefinedPayload(true);
    }
    if (combinedIntent.global && !validGlobalScopePayload(payload, params.version, combinedRequest)) {
      throw new Error("Refined global edit plan did not cover the exact target scenes");
    }
    if (combinedIntent.globalChineseRewrite && !validGlobalChinesePayload(payload, params.version, combinedRequest)) {
      payload = await requestRefinedPayload(true);
    }
    if (combinedIntent.globalChineseRewrite && !validGlobalChinesePayload(payload, params.version, combinedRequest)) {
      throw new Error("Refined Chinese edit plan did not localize every target field");
    }
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
        preservePayloadScope: true
      }
    );
    if (normalized.changes.length !== payload.changes.length) {
      throw new Error("Refined edit plan could not be normalized safely");
    }

    return {
      engine: activeTextModel.engine,
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
