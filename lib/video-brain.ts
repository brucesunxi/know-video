import { analyzeEditIntent, requestsGeneratedClip } from "@/lib/edit-intent";
import { fitSceneNarration } from "@/lib/narration-fit";
import { narrationVoiceForBrief, narrationVoiceFromRequest } from "@/lib/voice-profiles";
import type { EditPlan, GenerationOptions, Project, ProjectVersion, Scene } from "@/lib/types";
import { isProductionOnlyRequest, productionSettingsFromRequest } from "@/lib/production-edit-intent";
import {
  detectBriefDomain,
  extractBriefFacts,
  extractBriefSubject,
  extractBriefVisualConcepts,
  isVideoCreationProductBrief
} from "@/lib/brief-semantics";
import { visualStyleDirection, visualStyleProfile } from "@/lib/visual-style-profiles";

const palettes = {
  dark: ["#07111d", "#143044", "#38d5e5", "#f8fafc"],
  light: ["#ffffff", "#edf5f5", "#16b8c7", "#111827"],
  cinematic: ["#101015", "#5d4736", "#f5c46b", "#faf7f0"],
  playful: ["#fff8ec", "#2f80ed", "#ff6b6b", "#20c997"]
};

function detectTone(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("电影质感")) return "cinematic";
  if (lower.includes("极简高级")) return "light";
  if (lower.includes("明快有活力")) return "playful";
  if (lower.includes("温暖自然")) return "cinematic";
  if (lower.includes("light") || lower.includes("bright") || lower.includes("浅色") || lower.includes("白色") || lower.includes("极简")) return "light";
  if (lower.includes("cinematic") || lower.includes("电影") || lower.includes("高级感") || lower.includes("温暖")) return "cinematic";
  if (lower.includes("playful") || lower.includes("fun") || lower.includes("可爱") || lower.includes("活泼") || lower.includes("明快")) return "playful";
  return "dark";
}

function titleFromPrompt(prompt: string) {
  const cleaned = prompt.replace(/[。.!?？]/g, " ").trim();
  const first = cleaned.split(/\s+/).slice(0, 5).join(" ");
  return first.length > 0 ? first.slice(0, 40) : "Untitled Video";
}

function containsChinese(text: string) {
  return /\p{Script=Han}/u.test(text);
}

function distributeFallbackDurations(sceneCount: number, targetDuration: number) {
  const naturalDuration = Math.max(sceneCount * 3, Math.round(targetDuration * 0.9));
  const base = Math.floor(naturalDuration / sceneCount);
  const remainder = naturalDuration - base * sceneCount;
  return Array.from({ length: sceneCount }, (_, index) => base + (index < remainder ? 1 : 0));
}

function selectNarrativeScenes<T>(scenes: T[], count: number) {
  const indexes = count === 3
    ? [0, 2, 5]
    : count === 5
      ? [0, 1, 2, 3, 5]
      : [0, 1, 2, 3, 4, 5];
  return indexes.map((index) => scenes[index]);
}

function compactChineseNarration(text: string, maxCharacters: number) {
  const normalized = text.replace(/\s+/g, "").trim();
  if (normalized.replace(/[，。！？；、]/g, "").length <= maxCharacters) return normalized;

  const sentenceParts = normalized.match(/[^。！？；]+[。！？；]?/gu)?.map((part) => part.trim()).filter(Boolean) ?? [normalized];
  let candidate = "";
  for (const part of sentenceParts) {
    const next = `${candidate}${part}`;
    if (next.replace(/[，。！？；、]/g, "").length > maxCharacters) break;
    candidate = next;
  }
  if (candidate.replace(/[，。！？；、]/g, "").length >= Math.floor(maxCharacters * 0.68)) {
    return /[。！？；]$/u.test(candidate) ? candidate : `${candidate}。`;
  }

  const clauses = normalized.split(/[，。！？；]/u).map((part) => part.trim()).filter(Boolean);
  const bestClause = clauses.find((part) => part.length >= Math.floor(maxCharacters * 0.48) && part.length <= maxCharacters);
  if (bestClause) return `${bestClause}。`;

  return `${normalized.replace(/[，。！？；、]/g, "").slice(0, maxCharacters)}。`;
}

function compactEnglishNarration(text: string, maxWords: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const words = normalized.replace(/[,.!?;:]/g, "").split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return normalized;

  const sentences = normalized.match(/[^.!?;]+[.!?;]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [normalized];
  const kept: string[] = [];
  let wordCount = 0;
  for (const sentence of sentences) {
    const sentenceWords = sentence.replace(/[,.!?;:]/g, "").split(/\s+/).filter(Boolean);
    if (wordCount + sentenceWords.length > maxWords) break;
    kept.push(sentence);
    wordCount += sentenceWords.length;
  }
  if (wordCount >= Math.floor(maxWords * 0.62)) {
    const joined = kept.join(" ");
    return /[.!?]$/.test(joined) ? joined : `${joined}.`;
  }
  return `${words.slice(0, maxWords).join(" ")}.`;
}

function fitFallbackNarration(scene: Scene, durationSeconds: number, chinese: boolean) {
  if (chinese) {
    const maxCharacters = Math.max(12, Math.floor((durationSeconds - 0.25) * 5.1));
    const microNarration: Record<string, string> = {
      输入制作请求: "一句话，说清创意。",
      智能规划脚本: "自动规划每个镜头。",
      生成统一画面: "统一生成视觉画面。",
      通过对话改片: "对话即可改片。",
      保留创作版本: "版本随时恢复。",
      完成并导出: "一键导出成片。",
      开场钩子: "先抓住注意力。",
      问题情境: "问题就在眼前。",
      解决路径: "路径变得清晰。",
      效果证明: "结果清楚可见。",
      价值升华: "改变真正发生。",
      成果收束: "让价值被记住。"
    };
    if (durationSeconds <= 3.2 && microNarration[scene.title]) return microNarration[scene.title];
    return compactChineseNarration(scene.voiceover, maxCharacters);
  }

  const maxWords = Math.max(8, Math.floor((durationSeconds - 0.25) * 3.15));
  const microNarration: Record<string, string> = {
    "Describe the idea": "Start with one clear idea.",
    "Plan the story": "Every shot is planned.",
    "Create the visuals": "Visuals stay consistent.",
    "Revise through chat": "Revise it through chat.",
    "Keep every version": "Every version stays safe.",
    "Finish and export": "Export the finished film.",
    "Opening Hook": "Earn attention immediately.",
    "Problem Context": "Make the problem visible.",
    "Solution Flow": "Reveal a clear path.",
    "Proof Moment": "Show the result clearly.",
    "Human Outcome": "Make the change meaningful.",
    "Final Resolve": "End on lasting value."
  };
  if (durationSeconds <= 3.2 && microNarration[scene.title]) return microNarration[scene.title];
  return compactEnglishNarration(scene.voiceover, maxWords);
}

function domainFallbackNarrations(
  prompt: string,
  subject: string,
  facts: string[],
  concepts: string[],
  chinese: boolean
) {
  const domain = detectBriefDomain(prompt);
  const concept = (pattern: RegExp, chineseFallback: string, englishFallback: string) => {
    const found = concepts.find((item) => pattern.test(item));
    return found ?? (chinese ? chineseFallback : englishFallback);
  };
  const factHint = (index: number) => facts[index]?.replace(/\s+/g, chinese ? "" : " ").trim();

  if (domain === "gaming") {
    const coreAction = concept(/玩法|操控|建造|制作|战斗|解谜|gameplay|player|craft|build|combat|puzzle/i, "核心操作", "the core action");
    const objective = concept(/关卡|目标|副本|quest|level|objective/i, "眼前的关卡目标", "the objective ahead");
    const progression = concept(/成长|升级|养成|progression|upgrade/i, "角色成长", "character progression");
    if (!chinese) {
      return [
        `Step into ${subject}, where the first decision already belongs to the player.`,
        `${coreAction} is easy to read, and the world responds immediately to every move.`,
        `With ${objective} in sight, players can observe, experiment, and find their own route.`,
        `As ${progression} unfolds, familiar challenges open into new possibilities.`,
        `A successful run feels earned because its outcome comes from the player's choices.`,
        `Enter ${subject} and discover what your next run can become.`
      ];
    }
    return [
      `踏进${subject}，第一步就由玩家自己决定。`,
      `${coreAction}清楚直接，世界会立刻回应每次行动。`,
      `面对${objective}，观察、尝试，再走出自己的路线。`,
      `随着${progression}展开，熟悉的挑战也有了新可能。`,
      "当目标达成，成就感来自玩家亲手做出的选择。",
      `进入${subject}，看看下一局会变成什么样。`
    ];
  }

  if (domain === "education") {
    return chinese ? [
      `从真实学习难点出发，${subject}先让复杂知识变得容易理解。`,
      "清晰步骤连接讲解与练习，让学习者始终跟得上节奏。",
      "每一次操作和反馈，都把抽象概念变成可以应用的方法。",
      "随着理解加深，学习者能够独立解决更具体的问题。",
      "最终收获的不只是记住内容，而是真正会用的能力。",
      `从${subject}开始，让下一次学习自然发生。`
    ] : [
      `${subject} starts with a real learning challenge and makes complex knowledge easier to understand.`,
      "Clear steps connect explanation with practice, helping learners stay oriented.",
      "Every action and response turns an abstract idea into something usable.",
      "As understanding grows, learners can solve more concrete problems independently.",
      "The outcome is not just remembered content, but a skill that can be applied.",
      `Start with ${subject} and carry learning into the next real situation.`
    ];
  }

  if (domain === "commerce") {
    return chinese ? [
      `${subject}先把真正值得关注的商品价值清楚呈现。`,
      "从发现、比较到选择，每一步都围绕消费者的真实需求展开。",
      "可靠信息和直观细节，让决定更轻松，也更有把握。",
      "下单之后，进度与交付保持清楚，减少等待中的不确定。",
      "最终抵达的不只是一次购买，而是一段顺畅可信的体验。",
      `现在体验${subject}，找到更适合你的选择。`
    ] : [
      `${subject} makes the product value that matters immediately clear.`,
      "From discovery and comparison to selection, each step follows a real customer need.",
      "Reliable information and tangible detail make the decision easier and more confident.",
      "After checkout, clear progress and delivery reduce uncertainty.",
      "The result is more than a purchase: it is a smooth, trustworthy experience.",
      `Explore ${subject} and find the choice that fits.`
    ];
  }

  if (!chinese) {
    const gates = concept(/gate|checkpoint/i, "多道 Gate 检查点", "gated checkpoints");
    const evidence = concept(/evidence|audit/i, "可审查证据包", "reviewable evidence packets");
    const record = concept(/trace|record/i, "可追溯记录链", "traceable record trails");
    const responsibility = concept(/accountability|responsibility|ownership/i, "责任链路", "accountability chains");
    const risk = concept(/risk|signal/i, "风险信号地图", "risk signal maps");
    return [
      `When pressure scatters across the project, ${subject} makes the first risk visible and actionable.`,
      `Instead of relying on memory, ${gates} connect approvals, ownership, and key decisions into one visible path.`,
      `${evidence} move through ${record}, giving every important judgment a source, owner, and next step.`,
      `When ${risk} change, the team can follow ${responsibility} to locate issues and recover context quickly.`,
      `The result is steadier execution, with evidence, alignment, and confidence moving in the same direction.`,
      `By the end, the next action is clear, reviewable, and ready for delivery.`
    ].map((line, index) => factHint(index) && factHint(index)!.length < 120 ? `${line} ${factHint(index)}` : line);
  }

  const hasGate = concepts.some((item) => /Gate|检查点|gate/i.test(item));
  const hasEvidence = concepts.some((item) => /证据|evidence|audit/i.test(item));
  const hasRecord = concepts.some((item) => /追溯|记录|trace/i.test(item));
  const hasResponsibility = concepts.some((item) => /责任|accountability|ownership/i.test(item));
  const hasRisk = concepts.some((item) => /风险|信号|risk/i.test(item));
  const gates = hasGate ? "多道Gate" : "关键节点";
  const evidence = hasEvidence ? "证据包" : "业务材料";
  const record = hasRecord ? "记录链" : "工作链路";
  const responsibility = hasResponsibility ? "责任链" : "协作链";
  const risk = hasRisk ? "风险变化" : "项目变化";
  const lines = [
    `当项目压力分散时，${subject}先让关键风险浮出水面。`,
    `${gates}串起授权和${responsibility}，每个关键判断都有依据。`,
    `${evidence}沿${record}沉淀，材料、预算和阵容变化都可追溯。`,
    `当${risk}出现时，团队顺着${responsibility}快速定位问题。`,
    `最终获得的不是一句结论，而是更稳的推进、更顺的协作。`,
    `下一步行动留在同一条记录里，重要工作可以持续向前。`
  ];
  return lines;
}

function localizedFallbackDirection(
  scene: Scene,
  index: number,
  chinese: boolean,
  style?: GenerationOptions["style"],
  prompt = ""
): Scene {
  if (!chinese) return scene;
  const profile = visualStyleProfile(style);
  const subject = scene.title.replace(/[：:]/g, "").trim();
  const briefSubject = extractBriefSubject(prompt, true);
  const domain = detectBriefDomain(prompt);
  const visualDirections = domain === "gaming"
    ? [
        `微距特写，${briefSubject}中最有辨识度的玩家角色或核心道具成为画面主体；前景是可交互机关与材质细节，中景角色做出第一步明确操作，背景建立完整游戏世界。${profile.lighting}，${profile.composition}，不出现企业办公室、控制台或漂浮数据卡片。`,
        `俯拍广角镜头，一段真实可玩的关卡路径清楚展开；前景可拾取物与障碍形成节奏，中景玩家角色朝具体目标移动，背景揭示下一处挑战。${profile.cameraLanguage}，${profile.palette.join("、")}色彩贯穿游戏世界，规则通过动作与空间表达。`,
        `中等景别，玩家角色完成一次核心玩法动作，机关、敌人或环境立刻产生可见反馈；前景粒子与道具形成遮挡，中景动作清晰，背景保持关卡纵深。${profile.lighting}，角色、场景和道具风格统一。`,
        `宽幅远景，${briefSubject}的挑战升级为完整游戏遭遇；玩家的选择改变路线、敌人状态或环境结构，前景形成引导线，中景保留可读动作，背景显示尚未探索的区域。${profile.composition}，坚持${profile.artDirection}。`,
        `近景特写，镜头捕捉玩家完成目标后的角色反应、奖励反馈或创造成果；前景保留高质量材质，中景主体锐利，背景柔和分层。${profile.cameraLanguage}，避免任何企业流程意象。`,
        `完成镜头，${briefSubject}的角色与最终关卡成果成为画面中心；环境保留自然动态，胜利、解锁或继续探索的下一步清楚可见。${profile.lighting}，画面符合${profile.label}并形成真正的游戏宣传片收束。`
      ]
    : [
        `微距特写，${subject}以一个真实、明确的核心物件作为视觉主体；前景保留${profile.materials}的材质细节，中景出现正在操作的手与关键动作，背景是符合${profile.label}的专业环境。${profile.lighting}，${profile.composition}，画面不出现漂浮卡片或大段文字。`,
        `俯拍广角镜头，围绕${subject}的真实素材形成清晰叙事路径；前景有与${profile.materials}一致的细节，中景双手正在整理顺序，背景自然虚化。${profile.cameraLanguage}，${profile.palette.join("、")}色彩体系贯穿画面。`,
        `中等景别，人物在符合${profile.label}的真实空间中推进${subject}；前景形成自然遮挡，中景人物与核心画面构成稳定关系，背景建立空间纵深。${profile.lighting}，材质语言为${profile.materials}。`,
        `宽幅远景，${subject}在完整可信的使用环境中发生；前景形成引导线，中景人物与关键物件产生明确互动，背景建立空间深度。${profile.composition}，整体坚持${profile.artDirection}。`,
        `近景特写，镜头聚焦${subject}带来的具体变化与人物反应；前景保留细节，中景主体锐利，背景柔和分层。${profile.cameraLanguage}，色彩严格保持${profile.palette.join("、")}。`,
        `完成镜头，${subject}以具体成果成为画面中心；前景形成稳定基座，中景成果清楚可见，背景空间自然收束。${profile.lighting}，最终画面符合${profile.label}而不是其他预设：避免${profile.avoid}。`
      ];
  const motionDirections = [
    "摄影机从极近距离缓慢推近，主体动作由静止转为发生，前中后景产生细微视差；一束连续光轨沿画面方向移动，并自然牵引到下一场。",
    "摄影机在桌面上方平稳横移，素材依次翻转、靠拢并形成顺序，人物双手完成最后一次调整；边缘光线扫过画面后衔接下一镜头。",
    "摄影机围绕人物进行轻缓弧形运动，人物动作与环境画面同步推进，前景反射和背景灯带产生明显视差；核心画面逐渐铺满镜头完成转场。",
    "摄影机从环境入口缓慢向前移动，人物与关键物件在不同景深层次中依次被揭示，环境光沿空间连续变化；运动方向保持统一并带入下一场。",
    "镜头轻微推向人物反应与核心细节，主体完成一个清楚可见的动作，背景光斑随焦点转换而移动；最后以匹配动作或相同色彩切入下一镜头。",
    "摄影机从低机位缓慢后移，最终成果稳定呈现，人物与环境只保留自然微动，光线逐步收束到核心主体；画面在完整构图中停留后结束。"
  ];
  const directionIndex = Math.min(index, visualDirections.length - 1);
  return {
    ...scene,
    visualPrompt: visualDirections[directionIndex],
    motionPrompt: motionDirections[directionIndex],
    style: {
      ...scene.style,
      theme: `${profile.label} · ${profile.artDirection}`,
      palette: profile.palette,
      mood: index === 0 ? "专注而充满期待" : index === visualDirections.length - 1 ? "从容而坚定" : "清晰而富有推进感"
    }
  };
}

function applyFallbackConstraints(
  scenes: Scene[],
  options?: GenerationOptions,
  chinese = true,
  prompt = ""
) {
  const count = options?.sceneCount === "auto" || !options?.sceneCount
    ? 5
    : Number(options.sceneCount);
  const targetDuration = Number(options?.duration ?? 30);
  const durations = distributeFallbackDurations(count, targetDuration);
  return selectNarrativeScenes(scenes, count).map((scene, index) => localizedFallbackDirection({
      ...scene,
      id: crypto.randomUUID(),
      sceneNumber: index + 1,
      durationSeconds: durations[index],
      voiceover: fitFallbackNarration(scene, durations[index], chinese)
    }, index, chinese, options?.style, prompt));
}

function visualConceptSuffix(prompt: string, chinese: boolean) {
  const concepts = extractBriefVisualConcepts(prompt, chinese);
  if (concepts.length === 0) return "";
  if (detectBriefDomain(prompt) === "gaming") {
    return chinese
      ? ` 游戏视觉锚点：${concepts.join("、")}；把这些内容表现为玩家可执行的动作、关卡目标、角色反馈、挑战变化和奖励结果，避免企业办公室、治理流程、数据看板或抽象科技背景。`
      : ` Game visual anchors: ${concepts.join(", ")}; show them as player-controlled actions, playable objectives, character feedback, changing challenges, and earned rewards. Avoid enterprise offices, governance workflows, dashboards, or abstract technology backgrounds.`;
  }
  return chinese
    ? ` 业务视觉锚点：${concepts.join("、")}；将这些概念转化为真实可见的空间结构、箭头路径、检查点、证据包、责任链或风险地图，避免只做抽象科技背景。`
    : ` Brief visual anchors: ${concepts.join(", ")}; translate them into visible spatial structures, arrow paths, checkpoints, evidence packets, responsibility chains, or risk maps rather than generic tech imagery.`;
}

export function generateProjectFromPrompt(
  prompt: string,
  baseProject?: Project,
  options?: GenerationOptions
): Project {
  const promptTitle = titleFromPrompt(prompt);
  const tone = detectTone(`${prompt} ${options?.style ?? ""}`);
  const styleProfile = options?.style ? visualStyleProfile(options.style) : undefined;
  const palette = styleProfile?.palette ?? palettes[tone];
  const chinese = options?.language !== "英文";
  const title = chinese
    ? containsChinese(promptTitle) ? promptTitle : "创意视频项目"
    : containsChinese(promptTitle) ? "Creative Video" : promptTitle;
  const videoGenerationBlueprints: Scene[] = [
    {
      id: crypto.randomUUID(),
      sceneNumber: 1,
      title: chinese ? "输入制作请求" : "Describe the idea",
      voiceover: chinese
        ? "用户只需要描述想做的视频，Know Video 就会把目标、受众、时长和风格整理成清晰的制作简报。"
        : "Describe the video you want, and Know Video turns the goal, audience, timing, and style into a clear production brief.",
      visualPrompt: `${tone} product video scene: a creator types a video request into Know Video, the prompt expands into audience, goal, tone, and duration chips.`,
      motionPrompt: "Camera pushes toward the prompt box, then the request fans out into structured production cards.",
      durationSeconds: 6,
      style: { theme: tone, palette, mood: "focused" },
      assets: []
    },
    {
      id: crypto.randomUUID(),
      sceneNumber: 2,
      title: chinese ? "智能规划脚本" : "Plan the story",
      voiceover: chinese
        ? "系统自动拆出脚本、旁白、镜头画面和运动提示词，让创意从一句话变成可执行的分镜。"
        : "The system develops the script, narration, visual direction, and camera movement into a production-ready storyboard.",
      visualPrompt: `${tone} storyboard workspace with five scene cards, narration lines, visual prompt panels, and timing markers generated from the request.`,
      motionPrompt: "Five scene cards slide into a timeline while script lines type in below each card.",
      durationSeconds: 7,
      style: { theme: tone, palette, mood: "systematic" },
      assets: []
    },
    {
      id: crypto.randomUUID(),
      sceneNumber: 3,
      title: chinese ? "生成统一画面" : "Create the visuals",
      voiceover: chinese
        ? "每个场景都在同一套视觉语言下生成，让人物、色彩、光线和构图保持连贯。"
        : "Each scene is created within one visual language, keeping subjects, color, lighting, and composition coherent.",
      visualPrompt: `${tone} video preview player showing an AI-generated product video with progress bar, scene thumbnails, and animated UI elements.`,
      motionPrompt: "The playhead moves across the timeline, preview panels animate, and the current scene enlarges.",
      durationSeconds: 6,
      style: { theme: tone, palette, mood: "polished" },
      assets: []
    },
    {
      id: crypto.randomUUID(),
      sceneNumber: 4,
      title: chinese ? "通过对话改片" : "Revise through chat",
      voiceover: chinese
        ? "如果画面、节奏或风格不满意，直接用对话提出修改，系统会生成逐场景的修改计划。"
        : "Ask for changes in plain language, and Know Video turns the request into a scene-by-scene revision plan.",
      visualPrompt: `${tone} split-screen editor: video preview on the left, chat instruction on the right, before-after scene diff cards appearing below.`,
      motionPrompt: "A chat message transforms into highlighted before-and-after cards for affected scenes.",
      durationSeconds: 6,
      style: { theme: tone, palette, mood: "responsive" },
      assets: []
    },
    {
      id: crypto.randomUUID(),
      sceneNumber: 5,
      title: chinese ? "保留创作版本" : "Keep every version",
      voiceover: chinese
        ? "每次确认修改都会生成可恢复的新版本，让大胆尝试和精细调整都更安心。"
        : "Every approved revision becomes a restorable version, making both bold experiments and precise refinements safer.",
      visualPrompt: `${tone} final export scene with Know Video version history, approved edit plan, render complete status, and export/share buttons.`,
      motionPrompt: "The accepted version moves to the front, render status reaches complete, and export buttons glow subtly.",
      durationSeconds: 5,
      style: { theme: tone, palette, mood: "confident" },
      assets: []
    },
    {
      id: crypto.randomUUID(),
      sceneNumber: 6,
      title: chinese ? "完成并导出" : "Finish and export",
      voiceover: chinese
        ? "确认成片后，系统会合成画面、字幕和自然配音，输出可以直接交付的高清视频。"
        : "When the film is approved, visuals, captions, and narration are composed into a delivery-ready high-resolution video.",
      visualPrompt: `${tone} final cinematic delivery scene for Know Video, completed film playing full-frame on a premium studio monitor, restrained export confirmation and version strip in the environment.`,
      motionPrompt: "The finished sequence resolves on the monitor, the timeline locks, and the camera eases back into a confident final composition.",
      durationSeconds: 5,
      style: { theme: tone, palette, mood: "confident" },
      assets: []
    }
  ];
  if (isVideoCreationProductBrief(prompt)) {
    const videoGenerationScenes = applyFallbackConstraints(videoGenerationBlueprints, options, chinese, prompt);
    return {
      ...(baseProject ?? {
        id: crypto.randomUUID(),
        engine: "Animation Engine",
        credits: 996,
        plan: "Free"
      }),
      title: chinese ? "Know Video 产品介绍" : "Know Video Product Film",
      currentVersion: {
        id: crypto.randomUUID(),
        label: "draft 1",
        status: "planning",
        createdAt: new Date().toISOString(),
        durationSeconds: videoGenerationScenes.reduce((sum, scene) => sum + scene.durationSeconds, 0),
        scenes: videoGenerationScenes
      }
    };
  }

  const briefSubject = extractBriefSubject(prompt, chinese);
  const briefFacts = extractBriefFacts(prompt, chinese);
  const briefConcepts = extractBriefVisualConcepts(prompt, chinese);
  const conceptSuffix = visualConceptSuffix(prompt, chinese);
  const styleSuffix = options?.style ? ` ${chinese ? "视觉风格档案" : "Visual style bible"}：${visualStyleDirection(options.style)}` : "";
  const businessNarrations = domainFallbackNarrations(prompt, briefSubject, briefFacts, briefConcepts, chinese);
  const fallbackDomain = detectBriefDomain(prompt);
  const fallbackTitle = briefSubject === "这项产品" || briefSubject === "This product"
    ? title
    : fallbackDomain === "gaming"
      ? (chinese ? `${briefSubject} 游戏预告` : `${briefSubject} Game Trailer`)
      : (chinese ? `${briefSubject} 产品介绍` : `${briefSubject} Product Film`);
  const fallbackTitles = fallbackDomain === "gaming"
    ? (chinese
        ? ["进入游戏", "玩法上手", "挑战升级", "策略变化", "赢得成果", "开始下一局"]
        : ["Enter the Game", "Learn the Loop", "Raise the Challenge", "Change the Strategy", "Earn the Result", "Start the Next Run"])
    : (chinese
        ? ["开场钩子", "问题情境", "解决路径", "效果证明", "价值升华", "成果收束"]
        : ["Opening Hook", "Problem Context", "Solution Flow", "Proof Moment", "Human Outcome", "Final Resolve"]);
  const fallbackFact = (index: number, chineseFallback: string, englishFallback: string) => (
    businessNarrations[index] ?? (chinese ? chineseFallback : englishFallback)
  );
  const genericBlueprints: Scene[] = [
    {
      id: crypto.randomUUID(),
      sceneNumber: 1,
      title: fallbackTitles[0],
      voiceover: fallbackFact(0, `${briefSubject}，让企业最重要的价值被清楚看见。`, `${briefSubject} makes the company's most important value clear.`),
      visualPrompt: fallbackDomain === "gaming"
        ? `${tone} cinematic opening gameplay frame for ${briefSubject}, one recognizable player-controlled character entering a specific playable world, a clear objective visible ahead, foreground interactive props, layered level depth, no office or enterprise dashboard.${conceptSuffix}${styleSuffix}`
        : `${tone} opening cinematic frame for ${briefSubject}, strong product signal, real environment, one clear hero subject.${conceptSuffix}${styleSuffix}`,
      motionPrompt: "Camera pushes in slowly while the headline resolves and supporting UI details fade into place.",
      durationSeconds: 6,
      style: { theme: tone, palette, mood: "clear" },
      assets: []
    },
    {
      id: crypto.randomUUID(),
      sceneNumber: 2,
      title: fallbackTitles[1],
      voiceover: fallbackFact(1, `面对复杂业务，${briefSubject}帮助团队更早识别问题并建立清晰共识。`, `In complex work, ${briefSubject} helps teams identify problems earlier and build shared clarity.`),
      visualPrompt: fallbackDomain === "gaming"
        ? `${tone} playable tutorial encounter for ${briefSubject}: the player character performs the core action, the environment responds instantly, obstacles and objective are readable through space and motion, no business workflow imagery.${conceptSuffix}${styleSuffix}`
        : `${tone} problem scene for ${briefSubject}: a real user faces the central challenge stated in the brief, expressed through concrete objects, environment, and action.${conceptSuffix}${styleSuffix}`,
      motionPrompt: "Cards drift apart, warning states appear, then pause for emphasis.",
      durationSeconds: 7,
      style: { theme: tone, palette, mood: "focused" },
      assets: []
    },
    {
      id: crypto.randomUUID(),
      sceneNumber: 3,
      title: fallbackTitles[2],
      voiceover: fallbackFact(2, `${briefSubject}把关键流程连接起来，让每一步都有依据、责任与行动路径。`, `${briefSubject} connects the critical workflow so every step has evidence, ownership, and a path to action.`),
      visualPrompt: fallbackDomain === "gaming"
        ? `${tone} escalating gameplay scene for ${briefSubject}: a richer level opens around the player character, hazards and rewards create a clear route, one decisive action changes the encounter, strong foreground-midground-background depth.${conceptSuffix}${styleSuffix}`
        : `${tone} solution scene for ${briefSubject}: the product's concrete mechanism connects the user's starting problem to a visible improved state through one clear action.${conceptSuffix}${styleSuffix}`,
      motionPrompt: "Steps connect from left to right, then the active step expands.",
      durationSeconds: 8,
      style: { theme: tone, palette, mood: "systematic" },
      assets: []
    },
    {
      id: crypto.randomUUID(),
      sceneNumber: 4,
      title: fallbackTitles[3],
      voiceover: fallbackFact(3, `从分散信息到可验证成果，${briefSubject}让改进过程清晰、可信并且可追溯。`, `From scattered information to verifiable outcomes, ${briefSubject} makes improvement clear, credible, and traceable.`),
      visualPrompt: fallbackDomain === "gaming"
        ? `${tone} strategic gameplay variation for ${briefSubject}: two visible player choices produce meaningfully different routes or outcomes inside the same coherent game world, readable action and environmental feedback.${conceptSuffix}${styleSuffix}`
        : `${tone} proof scene for ${briefSubject}: the brief's promised change is visible in a specific result, user reaction, or before-after condition.${conceptSuffix}${styleSuffix}`,
      motionPrompt: "Before state compresses, after state slides in with highlighted metrics.",
      durationSeconds: 7,
      style: { theme: tone, palette, mood: "confident" },
      assets: []
    },
    {
      id: crypto.randomUUID(),
      sceneNumber: 5,
      title: fallbackTitles[4],
      voiceover: fallbackFact(4, `最终，团队获得的不只是效率，更是更稳定的判断、更顺畅的协作和更可靠的结果。`, `The result is more than efficiency: teams gain stronger decisions, smoother collaboration, and more reliable outcomes.`),
      visualPrompt: fallbackDomain === "gaming"
        ? `${tone} earned gameplay outcome for ${briefSubject}: the player character completes the objective, reward feedback and world reaction make success unmistakable, emotional close-up with the level still visible behind.${conceptSuffix}${styleSuffix}`
        : `${tone} closing outcome scene for ${briefSubject}: the promised human or customer outcome is fully visible in a calm, concrete, believable environment.${conceptSuffix}${styleSuffix}`,
      motionPrompt: "Logo and takeaway fade in, background elements settle, then hold.",
      durationSeconds: 6,
      style: { theme: tone, palette, mood: "polished" },
      assets: []
    },
    {
      id: crypto.randomUUID(),
      sceneNumber: 6,
      title: fallbackTitles[5],
      voiceover: fallbackFact(5, `${briefSubject}，让真正重要的工作持续向前。`, `${briefSubject} keeps the work that matters moving forward.`),
      visualPrompt: fallbackDomain === "gaming"
        ? `${tone} final game trailer frame for ${briefSubject}: recognizable hero character, resolved level objective, one enticing unexplored path or next challenge, coherent world identity, cinematic hold, no enterprise visual language.${conceptSuffix}${styleSuffix}`
        : `${tone} closing cinematic frame for ${briefSubject}, one concrete hero subject, resolved environment, strong visual identity, premium spacing, no generic presentation layout.${conceptSuffix}${styleSuffix}`,
      motionPrompt: "The final subject settles into a clean hero composition, environmental motion slows, and the camera holds for a confident finish.",
      durationSeconds: 6,
      style: { theme: tone, palette, mood: "resolved" },
      assets: []
    }
  ];
  const narrationVoice = narrationVoiceForBrief(prompt);
  const scenes = applyFallbackConstraints(genericBlueprints, options, chinese, prompt).map((scene) => ({
    ...scene,
    style: { ...scene.style, narrationVoice }
  }));

  return {
    ...(baseProject ?? {
      id: crypto.randomUUID(),
      engine: "Animation Engine",
      credits: 996,
      plan: "Free"
    }),
    title: fallbackTitle,
    currentVersion: {
      id: crypto.randomUUID(),
      label: "draft 1",
      status: "planning",
      createdAt: new Date().toISOString(),
      durationSeconds: scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0),
      scenes
    }
  };
}

export function buildEditPlanFromRequest(params: {
  request: string;
  version: ProjectVersion;
  editNumber: number;
}): EditPlan {
  const tone = detectTone(params.request);
  const requestedVoice = narrationVoiceFromRequest(params.request);
  const requestedClip = requestsGeneratedClip(params.request);
  const requestedProductionSettings = productionSettingsFromRequest(params.request);
  const chineseRequest = containsChinese(params.request);
  const intent = analyzeEditIntent(
    params.request,
    params.version.scenes.map((scene) => scene.sceneNumber)
  );
  const targeted = new Set(intent.explicitSceneNumbers);
  const targetScenes = params.version.scenes.filter((scene) => targeted.has(scene.sceneNumber));
  const scenes = isProductionOnlyRequest(params.request)
    ? []
    : targetScenes.length > 0
    ? targetScenes
    : requestedClip && !intent.global
      ? []
      : params.version.scenes;

  return {
    id: crypto.randomUUID(),
    editNumber: params.editNumber,
    baseVersionId: params.version.id,
    status: "proposed",
    userRequest: params.request,
    summary: scenes.length === 0 && Object.keys(requestedProductionSettings).length > 0
      ? `更新全片的播放与品牌设置：${params.request}`
      : chineseRequest
        ? `按照“${params.request}”调整${scenes.length === params.version.scenes.length ? "全部场景" : `场景 ${scenes.map((scene) => scene.sceneNumber).join("、")}`}，保留未被指令影响的时长、旁白和场景结构。`
        : `I will update ${scenes.length === params.version.scenes.length ? "the full video" : `scene ${scenes.map((s) => s.sceneNumber).join(", ")}`} according to: "${params.request}". Timing and narration structure are preserved unless the scene text directly asks for content changes.`,
    affectedScenes: scenes.map((scene) => scene.sceneNumber),
    changes: scenes.map((scene) => {
      const currentTone = scene.style.theme.includes("light") ? "light" : "dark";
      const mediaOnly = Boolean(requestedVoice || requestedClip);
      return {
        sceneNumber: scene.sceneNumber,
        status: "updated",
        before: {
          title: scene.title,
          voiceover: scene.voiceover,
          narrationVoice: scene.style.narrationVoice,
          thumbnailTone: currentTone,
          visualPrompt: scene.visualPrompt,
          motionPrompt: scene.motionPrompt
        },
        after: {
          title: scene.title,
          voiceover: scene.voiceover,
          narrationVoice: requestedVoice ?? scene.style.narrationVoice,
          thumbnailTone: mediaOnly ? currentTone : tone === "light" ? "light" : "dark",
          visualPrompt: mediaOnly
            ? scene.visualPrompt
            : chineseRequest
              ? `${scene.visualPrompt}。修改要求：${params.request}。统一调整美术方向，保持画面层级清晰，并保留本场景原有叙事目的。`
              : `${scene.visualPrompt} Revision request: ${params.request}. Apply a ${tone} art direction, keep layout readable, and preserve the scene purpose.`,
          motionPrompt: requestedClip ? `${scene.motionPrompt}. ${params.request}` : scene.motionPrompt
        },
        regenerate: requestedVoice
          ? ["audio", "render"]
          : requestedClip
            ? ["clip", "render"]
            : ["image", "clip", "thumbnail", "render"]
      };
    }),
    productionSettings: Object.keys(requestedProductionSettings).length > 0 ? requestedProductionSettings : undefined,
    createdAt: new Date().toISOString()
  };
}

export function applyEditPlan(project: Project, plan: EditPlan): Project {
  const nextScenes = project.currentVersion.scenes.map((scene, index) => {
    const change = plan.changes.find((item) => item.sceneNumber === scene.sceneNumber);
    if (!change) {
      if (index !== 0 || !plan.productionSettings) return scene;
      return {
        ...scene,
        style: {
          ...scene.style,
          production: { ...scene.style.production, ...plan.productionSettings }
        }
      };
    }

    const theme = change.after.thumbnailTone === "light" ? "premium light" : scene.style.theme;
    const updatedScene = {
      ...scene,
      title: change.after.title || scene.title,
      voiceover: change.after.voiceover || scene.voiceover,
      visualPrompt: change.after.visualPrompt,
      motionPrompt: change.after.motionPrompt || scene.motionPrompt,
      style: {
        ...scene.style,
        theme,
        palette: change.after.thumbnailTone === "light" ? palettes.light : scene.style.palette,
        narrationVoice: change.after.narrationVoice ?? scene.style.narrationVoice,
        production: index === 0 && plan.productionSettings
          ? { ...scene.style.production, ...plan.productionSettings }
          : scene.style.production
      }
    };
    const usesDirectAudioSource = plan.referenceAssets?.some((reference) =>
      reference.referenceUsage === "source-media"
      && reference.contentType.startsWith("audio/")
      && (reference.targetSceneNumber === scene.sceneNumber || reference.targetSceneNumbers?.includes(scene.sceneNumber))
    );
    return usesDirectAudioSource ? updatedScene : fitSceneNarration(updatedScene);
  });

  return {
    ...project,
    currentVersion: {
      ...project.currentVersion,
      id: crypto.randomUUID(),
      label: `edit ${plan.editNumber}`,
      status: "planning",
      createdAt: new Date().toISOString(),
      renderUrl: undefined,
      renderJobId: undefined,
      scenes: nextScenes
    }
  };
}
