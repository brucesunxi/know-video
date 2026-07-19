import { analyzeEditIntent, requestsGeneratedClip } from "@/lib/edit-intent";
import { fitSceneNarration } from "@/lib/narration-fit";
import { narrationVoiceForBrief, narrationVoiceFromRequest } from "@/lib/voice-profiles";
import type { EditPlan, GenerationOptions, Project, ProjectVersion, Scene } from "@/lib/types";
import { isProductionOnlyRequest, productionSettingsFromRequest } from "@/lib/production-edit-intent";
import { extractBriefFacts, extractBriefSubject, isVideoCreationProductBrief } from "@/lib/brief-semantics";

const palettes = {
  dark: ["#07111d", "#143044", "#38d5e5", "#f8fafc"],
  light: ["#ffffff", "#edf5f5", "#16b8c7", "#111827"],
  cinematic: ["#101015", "#5d4736", "#f5c46b", "#faf7f0"],
  playful: ["#fff8ec", "#2f80ed", "#ff6b6b", "#20c997"]
};

function detectTone(text: string) {
  const lower = text.toLowerCase();
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
  const base = Math.floor(targetDuration / sceneCount);
  const remainder = targetDuration - base * sceneCount;
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

function fitFallbackNarration(scene: Scene, durationSeconds: number, chinese: boolean) {
  if (chinese) {
    const maxCharacters = Math.max(4, Math.floor((durationSeconds - 0.35) * 4));
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
    const compactVoiceover = scene.voiceover.replace(/\s+/g, "").trim();
    if (compactVoiceover.replace(/[，。！？；]/g, "").length <= maxCharacters) return compactVoiceover;
    const firstClause = scene.voiceover.split(/[，。！？；]/)[0]?.trim();
    if (firstClause && firstClause.length <= maxCharacters) return `${firstClause}。`;
    return `${scene.voiceover.replace(/[，。！？；\s]/g, "").slice(0, maxCharacters)}。`;
  }

  const maxWords = Math.max(3, Math.floor((durationSeconds - 0.35) * 2.45));
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
  const words = scene.voiceover.replace(/[,.!?]/g, "").trim().split(/\s+/);
  if (words.length <= maxWords) return scene.voiceover;
  return `${words.slice(0, maxWords).join(" ")}.`;
}

function localizedFallbackDirection(scene: Scene, index: number, chinese: boolean): Scene {
  if (!chinese) return scene;
  const subject = scene.title.replace(/[：:]/g, "").trim();
  const visualDirections = [
    `微距特写，${subject}以一个真实、明确的核心物件作为视觉主体；前景保留细腻的金属或玻璃纹理，中景出现正在操作的手与关键动作，背景是具有纵深的专业工作室环境。侧逆光勾勒主体边缘，冷青与暖金配色形成克制对比，浅景深把注意力牢牢集中在变化发生的瞬间，画面不出现漂浮卡片或大段文字。`,
    `俯拍广角镜头，围绕${subject}的真实素材在制作台上形成清晰的叙事路径；前景有铅笔、胶片和纸张的材质细节，中景双手正在整理顺序，背景工作室设备自然虚化。柔和顶光穿过半透明介质，青灰、炭黑和暖金色彩保持统一，鸟瞰构图让动作、空间与层次一眼可读。`,
    `中等景别，一位创作者在沉浸式工作空间中推进${subject}；前景玻璃反射形成自然遮挡，中景人物与核心画面构成稳定对角线，背景沿灯带向远处延伸。轮廓光刻画织物、金属和磨砂玻璃材质，冷色环境中保留温暖肤色，真实摄影质感清晰呈现人物动作与情绪。`,
    `宽幅远景，${subject}在一个完整、可信的制作环境中发生；前景设备边缘形成引导线，中景人物与关键物件产生明确互动，背景建筑结构和柔和灯光建立空间深度。广角透视保持自然，侧光与环境反射塑造混凝土、木材和玻璃质感，统一配色延续上一场但构图明显不同。`,
    `近景特写，镜头聚焦${subject}带来的具体变化与人物反应；前景细小光点掠过镜头，中景面部、手势或核心物件保持锐利，背景工作室化为柔和散景。暖色主光与冷色轮廓光共同塑造层次，材质纹理真实可辨，构图保留适度负空间并避免任何通用仪表盘式表达。`,
    `低机位远景，${subject}以完成后的真实成果成为画面中心；前景深色结构形成稳定基座，中景人物或成片载体清楚可见，背景开阔空间向上延伸。柔和顶光和屏幕反射照亮混凝土与织物材质，冷青、炭黑和暖金色彩自然收束，最终画面庄重、清晰且具有可交付的电影感。`
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
      theme: "统一电影纪实风格",
      mood: index === 0 ? "专注而充满期待" : index === visualDirections.length - 1 ? "从容而坚定" : "清晰而富有推进感"
    }
  };
}

function applyFallbackConstraints(
  scenes: Scene[],
  options?: GenerationOptions,
  chinese = true
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
    }, index, chinese));
}

export function generateProjectFromPrompt(
  prompt: string,
  baseProject?: Project,
  options?: GenerationOptions
): Project {
  const promptTitle = titleFromPrompt(prompt);
  const tone = detectTone(`${prompt} ${options?.style ?? ""}`);
  const palette = palettes[tone];
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
    const videoGenerationScenes = applyFallbackConstraints(videoGenerationBlueprints, options, chinese);
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
  const fallbackTitle = briefSubject === "这项产品" || briefSubject === "This product"
    ? title
    : chinese ? `${briefSubject} 产品介绍` : `${briefSubject} Product Film`;
  const fallbackFact = (index: number, chineseFallback: string, englishFallback: string) => {
    const fact = briefFacts[index];
    if (fact) return fact;
    return chinese ? chineseFallback : englishFallback;
  };
  const genericBlueprints: Scene[] = [
    {
      id: crypto.randomUUID(),
      sceneNumber: 1,
      title: chinese ? "开场钩子" : "Opening Hook",
      voiceover: fallbackFact(0, `${briefSubject}，让企业最重要的价值被清楚看见。`, `${briefSubject} makes the company's most important value clear.`),
      visualPrompt: `${tone} opening title card for ${prompt}, strong product signal, clean layout, readable headline.`,
      motionPrompt: "Camera pushes in slowly while the headline resolves and supporting UI details fade into place.",
      durationSeconds: 6,
      style: { theme: tone, palette, mood: "clear" },
      assets: []
    },
    {
      id: crypto.randomUUID(),
      sceneNumber: 2,
      title: chinese ? "问题情境" : "Problem Context",
      voiceover: fallbackFact(1, `面对复杂业务，${briefSubject}帮助团队更早识别问题并建立清晰共识。`, `In complex work, ${briefSubject} helps teams identify problems earlier and build shared clarity.`),
      visualPrompt: `${tone} problem scene with scattered cards, alerts, and timeline pressure around ${prompt}.`,
      motionPrompt: "Cards drift apart, warning states appear, then pause for emphasis.",
      durationSeconds: 7,
      style: { theme: tone, palette, mood: "focused" },
      assets: []
    },
    {
      id: crypto.randomUUID(),
      sceneNumber: 3,
      title: chinese ? "解决路径" : "Solution Flow",
      voiceover: fallbackFact(2, `${briefSubject}把关键流程连接起来，让每一步都有依据、责任与行动路径。`, `${briefSubject} connects the critical workflow so every step has evidence, ownership, and a path to action.`),
      visualPrompt: `${tone} workflow scene with three connected steps, interface panels, and visual hierarchy.`,
      motionPrompt: "Steps connect from left to right, then the active step expands.",
      durationSeconds: 8,
      style: { theme: tone, palette, mood: "systematic" },
      assets: []
    },
    {
      id: crypto.randomUUID(),
      sceneNumber: 4,
      title: chinese ? "效果证明" : "Proof Moment",
      voiceover: fallbackFact(3, `从分散信息到可验证成果，${briefSubject}让改进过程清晰、可信并且可追溯。`, `From scattered information to verifiable outcomes, ${briefSubject} makes improvement clear, credible, and traceable.`),
      visualPrompt: `${tone} before-after comparison for ${prompt}, measurable improvement, dashboard-like clarity.`,
      motionPrompt: "Before state compresses, after state slides in with highlighted metrics.",
      durationSeconds: 7,
      style: { theme: tone, palette, mood: "confident" },
      assets: []
    },
    {
      id: crypto.randomUUID(),
      sceneNumber: 5,
      title: chinese ? "价值升华" : "Human Outcome",
      voiceover: fallbackFact(4, `最终，团队获得的不只是效率，更是更稳定的判断、更顺畅的协作和更可靠的结果。`, `The result is more than efficiency: teams gain stronger decisions, smoother collaboration, and more reliable outcomes.`),
      visualPrompt: `${tone} closing brand card for ${prompt}, centered mark, concise takeaway, premium spacing.`,
      motionPrompt: "Logo and takeaway fade in, background elements settle, then hold.",
      durationSeconds: 6,
      style: { theme: tone, palette, mood: "polished" },
      assets: []
    },
    {
      id: crypto.randomUUID(),
      sceneNumber: 6,
      title: chinese ? "成果收束" : "Final Resolve",
      voiceover: fallbackFact(5, `${briefSubject}，让真正重要的工作持续向前。`, `${briefSubject} keeps the work that matters moving forward.`),
      visualPrompt: `${tone} closing cinematic frame for ${prompt}, one concrete hero subject, resolved environment, strong visual identity, premium spacing, no generic presentation layout.`,
      motionPrompt: "The final subject settles into a clean hero composition, environmental motion slows, and the camera holds for a confident finish.",
      durationSeconds: 6,
      style: { theme: tone, palette, mood: "resolved" },
      assets: []
    }
  ];
  const narrationVoice = narrationVoiceForBrief(prompt);
  const scenes = applyFallbackConstraints(genericBlueprints, options, chinese).map((scene) => ({
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
