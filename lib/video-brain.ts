import type { EditPlan, Project, ProjectVersion, Scene } from "@/lib/types";

const palettes = {
  dark: ["#07111d", "#143044", "#38d5e5", "#f8fafc"],
  light: ["#ffffff", "#edf5f5", "#16b8c7", "#111827"],
  cinematic: ["#101015", "#5d4736", "#f5c46b", "#faf7f0"],
  playful: ["#fff8ec", "#2f80ed", "#ff6b6b", "#20c997"]
};

function detectTone(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("light") || lower.includes("bright") || lower.includes("浅色") || lower.includes("白色")) return "light";
  if (lower.includes("cinematic") || lower.includes("电影") || lower.includes("高级感")) return "cinematic";
  if (lower.includes("playful") || lower.includes("fun") || lower.includes("可爱") || lower.includes("活泼")) return "playful";
  return "dark";
}

function titleFromPrompt(prompt: string) {
  const cleaned = prompt.replace(/[。.!?？]/g, " ").trim();
  const first = cleaned.split(/\s+/).slice(0, 5).join(" ");
  return first.length > 0 ? first : "Untitled Video";
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

export function generateProjectFromPrompt(prompt: string, baseProject?: Project): Project {
  const title = titleFromPrompt(prompt);
  const tone = detectTone(prompt);
  const palette = palettes[tone];
  const subject = title.toUpperCase();
  const videoGenerationScenes: Scene[] = [
    {
      id: crypto.randomUUID(),
      sceneNumber: 1,
      title: "输入制作请求",
      voiceover: "用户只需要描述想做的视频，Know Video 就会把目标、受众、时长和风格整理成清晰的制作 brief。",
      visualPrompt: `${tone} product video scene: a creator types a video request into Know Video, the prompt expands into audience, goal, tone, and duration chips.`,
      motionPrompt: "Camera pushes toward the prompt box, then the request fans out into structured production cards.",
      durationSeconds: 6,
      style: { theme: tone, palette, mood: "focused" },
      assets: []
    },
    {
      id: crypto.randomUUID(),
      sceneNumber: 2,
      title: "AI 自动分镜",
      voiceover: "系统自动拆出脚本、旁白、镜头画面和运动提示词，让创意从一句话变成可执行的分镜。",
      visualPrompt: `${tone} storyboard workspace with five scene cards, narration lines, visual prompt panels, and timing markers generated from the request.`,
      motionPrompt: "Five scene cards slide into a timeline while script lines type in below each card.",
      durationSeconds: 7,
      style: { theme: tone, palette, mood: "systematic" },
      assets: []
    },
    {
      id: crypto.randomUUID(),
      sceneNumber: 3,
      title: "生成视频预览",
      voiceover: "每个镜头都会进入预览播放器，用户可以先看整体节奏，再决定哪里需要调整。",
      visualPrompt: `${tone} video preview player showing an AI-generated product video with progress bar, scene thumbnails, and animated UI elements.`,
      motionPrompt: "The playhead moves across the timeline, preview panels animate, and the current scene enlarges.",
      durationSeconds: 6,
      style: { theme: tone, palette, mood: "polished" },
      assets: []
    },
    {
      id: crypto.randomUUID(),
      sceneNumber: 4,
      title: "聊天改片",
      voiceover: "如果画面、节奏或风格不满意，直接用对话提出修改，系统会生成逐场景的修改计划。",
      visualPrompt: `${tone} split-screen editor: video preview on the left, chat instruction on the right, before-after scene diff cards appearing below.`,
      motionPrompt: "A chat message transforms into highlighted before-and-after cards for affected scenes.",
      durationSeconds: 6,
      style: { theme: tone, palette, mood: "responsive" },
      assets: []
    },
    {
      id: crypto.randomUUID(),
      sceneNumber: 5,
      title: "确认并导出",
      voiceover: "确认修改后，Know Video 会生成新版本并进入导出流程，把视频制作变成可反复优化的工作流。",
      visualPrompt: `${tone} final export scene with Know Video version history, approved edit plan, render complete status, and export/share buttons.`,
      motionPrompt: "The accepted version moves to the front, render status reaches complete, and export buttons glow subtly.",
      durationSeconds: 5,
      style: { theme: tone, palette, mood: "confident" },
      assets: []
    }
  ];
  if (isVideoGenerationPrompt(prompt)) {
    return {
      ...(baseProject ?? {
        id: crypto.randomUUID(),
        engine: "Animation Engine",
        credits: 996,
        plan: "Free"
      }),
      title: "Know Video 产品介绍",
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

  const scenes: Scene[] = [
    {
      id: crypto.randomUUID(),
      sceneNumber: 1,
      title: "Opening Hook",
      voiceover: `${title} opens with the core promise in one clear sentence, giving viewers a reason to keep watching.`,
      visualPrompt: `${tone} opening title card for ${prompt}, strong product signal, clean layout, readable headline.`,
      motionPrompt: "Camera pushes in slowly while the headline resolves and supporting UI details fade into place.",
      durationSeconds: 6,
      style: { theme: tone, palette, mood: "clear" },
      assets: []
    },
    {
      id: crypto.randomUUID(),
      sceneNumber: 2,
      title: "Problem Context",
      voiceover: "The video frames the current friction, showing why the audience needs a more structured answer.",
      visualPrompt: `${tone} problem scene with scattered cards, alerts, and timeline pressure around ${prompt}.`,
      motionPrompt: "Cards drift apart, warning states appear, then pause for emphasis.",
      durationSeconds: 7,
      style: { theme: tone, palette, mood: "focused" },
      assets: []
    },
    {
      id: crypto.randomUUID(),
      sceneNumber: 3,
      title: "Solution Flow",
      voiceover: "The solution is broken into a step-by-step flow that makes the system feel achievable.",
      visualPrompt: `${tone} workflow scene with three connected steps, interface panels, and visual hierarchy.`,
      motionPrompt: "Steps connect from left to right, then the active step expands.",
      durationSeconds: 8,
      style: { theme: tone, palette, mood: "systematic" },
      assets: []
    },
    {
      id: crypto.randomUUID(),
      sceneNumber: 4,
      title: "Proof Moment",
      voiceover: "A concrete example shows the transformation from scattered work into a cleaner operating rhythm.",
      visualPrompt: `${tone} before-after comparison for ${prompt}, measurable improvement, dashboard-like clarity.`,
      motionPrompt: "Before state compresses, after state slides in with highlighted metrics.",
      durationSeconds: 7,
      style: { theme: tone, palette, mood: "confident" },
      assets: []
    },
    {
      id: crypto.randomUUID(),
      sceneNumber: 5,
      title: `${subject} Closing`,
      voiceover: "The closing scene reinforces the main outcome and leaves the audience with a memorable final frame.",
      visualPrompt: `${tone} closing brand card for ${prompt}, centered mark, concise takeaway, premium spacing.`,
      motionPrompt: "Logo and takeaway fade in, background elements settle, then hold.",
      durationSeconds: 6,
      style: { theme: tone, palette, mood: "polished" },
      assets: []
    }
  ];

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
      scenes: nextScenes
    }
  };
}
