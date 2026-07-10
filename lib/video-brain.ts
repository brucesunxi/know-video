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

export function generateProjectFromPrompt(prompt: string, baseProject?: Project): Project {
  const title = titleFromPrompt(prompt);
  const tone = detectTone(prompt);
  const palette = palettes[tone];
  const subject = title.toUpperCase();
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
        thumbnailTone: scene.style.theme.includes("light") ? "light" : "dark",
        visualPrompt: scene.visualPrompt
      },
      after: {
        title: scene.title,
        thumbnailTone: tone === "light" ? "light" : "dark",
        visualPrompt: `${scene.visualPrompt} Revision request: ${params.request}. Apply a ${tone} art direction, keep layout readable, and preserve the scene purpose.`
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
      visualPrompt: change.after.visualPrompt,
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
