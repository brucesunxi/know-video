export type AssetType = "image" | "audio" | "clip" | "thumbnail" | "caption" | "render" | "logo" | "music";
export type NarrationVoice = "male-clear" | "male-deep" | "female-natural";
export type PlaybackRate = 0.75 | 1 | 1.25 | 1.5;
export type CaptionStyle = "minimal" | "boxed" | "highlight";
export type LogoPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type MusicDucking = "off" | "balanced" | "strong";

export type ProductionSettings = {
  captionsEnabled: boolean;
  captionStyle: CaptionStyle;
  playbackRate: PlaybackRate;
  musicVolume: number;
  musicDucking: MusicDucking;
  logoPosition: LogoPosition;
  logoSize: number;
};

export type SceneStructureMutation =
  | { operation: "set-duration"; sceneNumber: number; durationSeconds: number }
  | { operation: "move"; sceneNumber: number; direction: "earlier" | "later" }
  | { operation: "move-to"; sceneNumber: number; targetSceneNumber: number }
  | { operation: "split"; sceneNumber: number }
  | { operation: "merge-next"; sceneNumber: number }
  | { operation: "duplicate"; sceneNumber: number }
  | { operation: "delete"; sceneNumber: number };

export type GenerationOptions = {
  duration: "15" | "30" | "45" | "60";
  sceneCount: "auto" | "3" | "5" | "6";
  language: "中文" | "英文";
  style: "电影质感" | "极简高级" | "明快有活力" | "温暖自然";
};

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
    narrationVoice?: NarrationVoice;
    production?: Partial<ProductionSettings>;
  };
  assets: SceneAsset[];
};

export type ProjectVersion = {
  id: string;
  parentVersionId?: string;
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

export type VersionChangeSummary = {
  changedScenes: number;
  addedScenes: number;
  removedScenes: number;
  durationDelta: number;
  description: string;
};

export type ProjectVersionSummary = Pick<
  ProjectVersion,
  "id" | "parentVersionId" | "status" | "createdAt" | "durationSeconds" | "renderUrl"
> & {
  label: string;
  sceneCount: number;
  isCurrent: boolean;
  changeSummary?: VersionChangeSummary;
};

export type ProjectVersionPreview = {
  version: ProjectVersion;
  currentVersion: ProjectVersion;
  changeSummary: VersionChangeSummary;
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
  versionLabel?: string;
};

export type Project = {
  id: string;
  title: string;
  engine: "Animation Engine";
  credits: number;
  plan: "Free" | "Pro" | "Enterprise";
  currentVersion: ProjectVersion;
};

export type ProjectListItem = {
  id: string;
  title: string;
  updatedAt: string;
  status: ProjectVersion["status"];
  durationSeconds: number;
  sceneCount: number;
  thumbnailUrl?: string;
};

export type EditChange = {
  sceneNumber: number;
  status: "updated" | "added" | "deleted" | "unchanged";
  before: {
    title: string;
    voiceover?: string;
    narrationVoice?: NarrationVoice;
    thumbnailTone: string;
    visualPrompt: string;
    motionPrompt?: string;
  };
  after: {
    title: string;
    voiceover?: string;
    narrationVoice?: NarrationVoice;
    thumbnailTone: string;
    visualPrompt: string;
    motionPrompt?: string;
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
  productionSettings?: Partial<ProductionSettings>;
  sceneStructure?: SceneStructureMutation;
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
