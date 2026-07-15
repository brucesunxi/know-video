export type AssetType = "image" | "audio" | "clip" | "thumbnail" | "caption" | "render";

export type SceneAsset = {
  id: string;
  type: AssetType;
  url: string;
  r2Key: string;
  metadata?: Record<string, unknown>;
};

export type Scene = {
  id: string;
  sceneNumber: number;
  title: string;
  voiceover: string;
  visualPrompt: string;
  motionPrompt: string;
  durationSeconds: number;
  style: {
    theme: string;
    palette: string[];
    mood: string;
  };
  assets: SceneAsset[];
};

export type ProjectVersion = {
  id: string;
  label: string;
  status: "draft" | "planning" | "rendering" | "ready" | "failed";
  createdAt: string;
  durationSeconds: number;
  renderUrl?: string;
  renderJobId?: string;
  assetStatus?: "pending" | "partial" | "ready" | "failed";
  assetErrorCode?: "missing_key" | "invalid_key" | "storage_failed" | "generation_failed";
  scenes: Scene[];
};

export type RenderJob = {
  id: string;
  projectId: string;
  versionId: string;
  status: "queued" | "running" | "ready" | "failed" | "cancelled";
  progress: number;
  error?: string;
  outputR2Key?: string;
  renderUrl?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type Project = {
  id: string;
  title: string;
  engine: "Animation Engine";
  credits: number;
  plan: "Free" | "Pro" | "Enterprise";
  currentVersion: ProjectVersion;
};

export type EditChange = {
  sceneNumber: number;
  status: "updated" | "added" | "deleted" | "unchanged";
  before: {
    title: string;
    voiceover?: string;
    thumbnailTone: string;
    visualPrompt: string;
  };
  after: {
    title: string;
    voiceover?: string;
    thumbnailTone: string;
    visualPrompt: string;
  };
  regenerate: AssetType[];
};

export type EditPlan = {
  id: string;
  editNumber: number;
  baseVersionId: string;
  status: "proposed" | "approved" | "rejected" | "applied";
  userRequest: string;
  summary: string;
  affectedScenes: number[];
  changes: EditChange[];
  createdAt: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  type: "text" | "plan" | "version" | "confirmation";
  content: string;
  versionId?: string;
  editPlan?: EditPlan;
};
