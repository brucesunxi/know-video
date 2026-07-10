import type { ChatMessage, EditPlan, Project, Scene } from "@/lib/types";

const darkScenes: Scene[] = [
  {
    id: "scene-1",
    sceneNumber: 1,
    title: "Three-Phase Governance Architecture",
    voiceover: "VYBEA is a project-level accountability governance operating environment built for entertainment IPs.",
    visualPrompt: "Dark premium product dashboard with three governance columns, cyan connectors, and executive console styling.",
    motionPrompt: "Panels glide forward, cyan data lines connect the columns, and a central status node pulses softly.",
    durationSeconds: 7,
    style: {
      theme: "premium dark",
      palette: ["#08111d", "#0e2232", "#38d5e5", "#f8fafc"],
      mood: "strategic"
    },
    assets: []
  },
  {
    id: "scene-2",
    sceneNumber: 2,
    title: "Project Cycle Map",
    voiceover: "It organizes decisions, tasks, approvals, and risks into one shared operating layer.",
    visualPrompt: "Circular project map on a dark navy board with small nodes orbiting a central governance hub.",
    motionPrompt: "Nodes orbit slowly, then lock into phase markers as labels fade in.",
    durationSeconds: 6,
    style: {
      theme: "premium dark",
      palette: ["#0b1522", "#1f3547", "#43c7d7", "#dbeafe"],
      mood: "systematic"
    },
    assets: []
  },
  {
    id: "scene-3",
    sceneNumber: 3,
    title: "Accountability Flow",
    voiceover: "Each team member sees the exact responsibility path from strategy to execution.",
    visualPrompt: "Dark interface with vertical accountability lanes, teal milestones, and connected owner cards.",
    motionPrompt: "Milestones drop into place, ownership cards slide in, and connecting lines trace the flow.",
    durationSeconds: 7,
    style: {
      theme: "premium dark",
      palette: ["#07111d", "#233748", "#4fd1c5", "#f1f5f9"],
      mood: "precise"
    },
    assets: []
  },
  {
    id: "scene-4",
    sceneNumber: 4,
    title: "Executive Review",
    voiceover: "Leaders can review progress, identify blockers, and keep creative work aligned with business outcomes.",
    visualPrompt: "Dark executive review dashboard with project cards, risk badges, approval indicators, and a large progress panel.",
    motionPrompt: "Project cards fan into the frame, risk badges resolve, and an approval panel slides up.",
    durationSeconds: 8,
    style: {
      theme: "premium dark",
      palette: ["#07111d", "#1d2f42", "#49c6e5", "#ffffff"],
      mood: "confident"
    },
    assets: []
  },
  {
    id: "scene-5",
    sceneNumber: 5,
    title: "VYBEA Closing Mark",
    voiceover: "The result is a clearer governance rhythm for complex entertainment projects.",
    visualPrompt: "Dark closing card with the VYBEA wordmark centered and a subtle constellation of governance points.",
    motionPrompt: "The wordmark fades in, points connect behind it, and the scene settles into a calm hold.",
    durationSeconds: 6,
    style: {
      theme: "premium dark",
      palette: ["#07111d", "#101e2d", "#38d5e5", "#f8fafc"],
      mood: "polished"
    },
    assets: []
  }
];

export const demoProject: Project = {
  id: "project-vybea",
  title: "VYBEA Governance Platform",
  engine: "Animation Engine",
  credits: 996,
  plan: "Free",
  currentVersion: {
    id: "version-004",
    label: "edit 4",
    status: "ready",
    createdAt: "2026-07-10T09:45:00.000Z",
    durationSeconds: 34,
    scenes: darkScenes,
    renderUrl: undefined
  }
};

export const lightThemeEditPlan: EditPlan = {
  id: "edit-plan-005",
  editNumber: 5,
  baseVersionId: "version-004",
  status: "proposed",
  userRequest: "Please adjust the style to a light color scheme.",
  summary:
    "Adapt the entire video to a premium, high-contrast light color scheme, creating a crisp modern SaaS console aesthetic while keeping the current structure, timing, and voiceover intact.",
  affectedScenes: [1, 2, 3, 4, 5],
  changes: darkScenes.map((scene) => ({
    sceneNumber: scene.sceneNumber,
    status: "updated",
    before: {
      title: scene.title,
      thumbnailTone: "dark",
      visualPrompt: scene.visualPrompt
    },
    after: {
      title: scene.title,
      thumbnailTone: "light",
      visualPrompt: scene.visualPrompt
        .replaceAll("Dark", "Light")
        .replaceAll("dark", "light")
        .concat(" Use white surfaces, soft gray depth, teal accents, and clean enterprise SaaS spacing.")
    },
    regenerate: ["image", "clip", "thumbnail"]
  })),
  createdAt: "2026-07-10T09:50:00.000Z"
};

export const demoMessages: ChatMessage[] = [
  {
    id: "message-1",
    role: "assistant",
    type: "version",
    content: "Previous version",
    versionId: "version-003"
  },
  {
    id: "message-2",
    role: "user",
    type: "text",
    content: lightThemeEditPlan.userRequest
  },
  {
    id: "message-3",
    role: "assistant",
    type: "plan",
    content: lightThemeEditPlan.summary,
    editPlan: lightThemeEditPlan
  }
];
