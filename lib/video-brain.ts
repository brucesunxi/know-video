import type { EditPlan, GenerationOptions, Project, ProjectVersion, Scene } from "@/lib/types";

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

function isVideoGenerationPrompt(prompt: string) {
  const lower = prompt.toLowerCase();
  return (
    lower.includes("video generation") ||
    lower.includes("text-to-video") ||
    lower.includes("ai video") ||
    prompt.includes("视频生成") ||
    prompt.includes("生成视频") ||
    prompt.includes("分镜")
  );
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
  return selectNarrativeScenes(scenes, count).map((scene, index) => ({
    ...scene,
    id: crypto.randomUUID(),
    sceneNumber: index + 1,
    durationSeconds: durations[index],
    voiceover: fitFallbackNarration(scene, durations[index], chinese)
  }));
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
  if (isVideoGenerationPrompt(prompt)) {
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

  const genericBlueprints: Scene[] = [
    {
      id: crypto.randomUUID(),
      sceneNumber: 1,
      title: chinese ? "开场钩子" : "Opening Hook",
      voiceover: chinese
        ? `${title} 从一个清晰、有吸引力的核心承诺开场，让观众立即理解这支视频为什么值得继续看。`
        : `${title} opens with the core promise in one clear sentence, giving viewers a reason to keep watching.`,
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
      voiceover: chinese
        ? "视频呈现目标受众正在经历的真实阻力，让解决这个问题的价值变得具体而紧迫。"
        : "The video frames the current friction, showing why the audience needs a more structured answer.",
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
      voiceover: chinese
        ? "解决方案被拆成清晰的步骤，让复杂过程变得容易理解，也让行动路径触手可及。"
        : "The solution is broken into a step-by-step flow that makes the system feel achievable.",
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
      voiceover: chinese
        ? "一个具体案例展示改变如何发生，把抽象价值转化为观众能够看见和相信的结果。"
        : "A concrete example shows the transformation from scattered work into a cleaner operating rhythm.",
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
      voiceover: chinese
        ? "镜头回到使用者真正获得的改变，强化这套方案带来的长期价值和情绪回报。"
        : "The story returns to the human outcome, reinforcing the lasting value and emotional payoff of the solution.",
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
      voiceover: chinese
        ? "结尾再次聚焦最重要的成果，并用一个简洁、清晰、值得记住的画面结束整支视频。"
        : "The closing scene reinforces the main outcome and leaves the audience with a memorable final frame.",
      visualPrompt: `${tone} closing cinematic frame for ${prompt}, one concrete hero subject, resolved environment, strong visual identity, premium spacing, no generic presentation layout.`,
      motionPrompt: "The final subject settles into a clean hero composition, environmental motion slows, and the camera holds for a confident finish.",
      durationSeconds: 6,
      style: { theme: tone, palette, mood: "resolved" },
      assets: []
    }
  ];
  const scenes = applyFallbackConstraints(genericBlueprints, options, chinese);

  return {
    ...(baseProject ?? {
      id: crypto.randomUUID(),
      engine: "Animation Engine",
      credits: 996,
      plan: "Free"
    }),
    title,
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
  const targetScenes = params.version.scenes.filter((scene) => {
    const sceneToken = `scene ${scene.sceneNumber}`;
    const chineseToken = `第${scene.sceneNumber}`;
    const lower = params.request.toLowerCase();
    return lower.includes(sceneToken) || params.request.includes(chineseToken);
  });
  const scenes = targetScenes.length > 0 ? targetScenes : params.version.scenes;

  return {
    id: crypto.randomUUID(),
    editNumber: params.editNumber,
    baseVersionId: params.version.id,
    status: "proposed",
    userRequest: params.request,
    summary: `I will update ${scenes.length === params.version.scenes.length ? "the full video" : `scene ${scenes.map((s) => s.sceneNumber).join(", ")}`} according to: "${params.request}". Timing and narration structure are preserved unless the scene text directly asks for content changes.`,
    affectedScenes: scenes.map((scene) => scene.sceneNumber),
    changes: scenes.map((scene) => ({
      sceneNumber: scene.sceneNumber,
      status: "updated",
      before: {
        title: scene.title,
        voiceover: scene.voiceover,
        thumbnailTone: scene.style.theme.includes("light") ? "light" : "dark",
        visualPrompt: scene.visualPrompt,
        motionPrompt: scene.motionPrompt
      },
      after: {
        title: scene.title,
        voiceover: scene.voiceover,
        thumbnailTone: tone === "light" ? "light" : "dark",
        visualPrompt: `${scene.visualPrompt} Revision request: ${params.request}. Apply a ${tone} art direction, keep layout readable, and preserve the scene purpose.`,
        motionPrompt: scene.motionPrompt
      },
      regenerate: ["image", "clip", "thumbnail", "render"]
    })),
    createdAt: new Date().toISOString()
  };
}

export function applyEditPlan(project: Project, plan: EditPlan): Project {
  const nextScenes = project.currentVersion.scenes.map((scene) => {
    const change = plan.changes.find((item) => item.sceneNumber === scene.sceneNumber);
    if (!change) return scene;

    const theme = change.after.thumbnailTone === "light" ? "premium light" : scene.style.theme;
    return {
      ...scene,
      title: change.after.title || scene.title,
      voiceover: change.after.voiceover || scene.voiceover,
      visualPrompt: change.after.visualPrompt,
      motionPrompt: change.after.motionPrompt || scene.motionPrompt,
      style: {
        ...scene.style,
        theme,
        palette: change.after.thumbnailTone === "light" ? palettes.light : scene.style.palette
      }
    };
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
