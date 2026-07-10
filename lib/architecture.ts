export const pipelineSteps = [
  "User prompt, PDF, media, or chat edit enters the Vercel app",
  "Planner converts intent into a structured scene_plan or edit_patch",
  "Neon stores the project version, scenes, chat messages, and edit plan",
  "Worker regenerates only affected scene assets and uploads them to R2",
  "Remotion worker composes the latest version into an MP4 render",
  "Vercel serves the editor, timeline, version history, and share/export flows"
];
