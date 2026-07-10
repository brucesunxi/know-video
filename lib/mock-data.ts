import type { ChatMessage, EditPlan, Project, Scene } from "@/lib/types";

const darkScenes: Scene[] = [
  {
    id: "scene-1",
    sceneNumber: 1,
    title: "Prompt to Video Brief",
    voiceover: "Know Video turns a single production request into a structured video brief, script, and scene plan.",
    visualPrompt: "Premium product interface showing a text prompt transforming into a concise video production brief.",
    motionPrompt: "The prompt expands into structured cards for audience, goal, tone, and duration.",
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
    title: "Scene Breakdown",
    voiceover: "The system breaks the idea into scenes, each with narration, visual direction, motion, and timing.",
    visualPrompt: "Storyboard timeline with five scene cards, voiceover snippets, and motion prompt indicators.",
    motionPrompt: "Scene cards slide into a timeline and connect with subtle teal progress lines.",
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
    title: "Conversational Editing",
    voiceover: "After the first version, creators can ask for precise changes in natural language.",
    visualPrompt: "Split editor with video preview on the left and chat-based edit instructions on the right.",
    motionPrompt: "A user message becomes a before-and-after edit plan with highlighted affected scenes.",
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
    title: "Version Control",
    voiceover: "Every accepted change creates a new version, so teams can iterate without losing the original direction.",
    visualPrompt: "Clean version history panel with accepted edit plans, render status, and scene diffs.",
    motionPrompt: "Version chips stack upward while the current version is promoted into the preview.",
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
    title: "Know Video Export",
    voiceover: "Know Video brings planning, generation, review, and export into one focused production workflow.",
    visualPrompt: "Dark closing card with the Know Video wordmark, export button, and completed render timeline.",
    motionPrompt: "The Know Video mark fades in as the final render progress reaches complete.",
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
  id: "project-know-video",
  title: "Know Video Product Demo",
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
