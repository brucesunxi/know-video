"use client";

import { ChangeEvent, DragEvent, FormEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import type { PlayerRef } from "@remotion/player";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Captions,
  ChevronRight,
  Clapperboard,
  Clock3,
  Combine,
  Copy,
  Download,
  FileVideo2,
  Film,
  FolderOpen,
  GripVertical,
  History,
  Eye,
  ImagePlus,
  Layers3,
  Loader2,
  MessageSquareText,
  Mic2,
  MoreHorizontal,
  Music2,
  PanelRightOpen,
  Pencil,
  Plus,
  RefreshCcw,
  RotateCcw,
  Scissors,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { KnowVideoPlayer } from "@/app/video-player";
import { replacementAssetTypes } from "@/lib/asset-policy";
import { candidateEditFromRequest } from "@/lib/candidate-edit-intent";
import { editPlanVisualSceneNumbers, planPreviewAsset, removeEditPlanPreviewAssets } from "@/lib/edit-plan-preview-assets";
import { parsePendingGenerationSession, PENDING_GENERATION_STORAGE_KEY, type PendingGenerationSession } from "@/lib/generation-session";
import { missingMotionSceneNumbers, missingSceneAssetNumbers, sceneHasAudioAsset, sceneHasVisualAsset } from "@/lib/generation-resume";
import { selectMotionCriticalScenes } from "@/lib/motion-scene-selection";
import { productionAsset, productionSettings } from "@/lib/production-settings";
import { sceneSplitPreview, type SceneStructureMutation } from "@/lib/scene-structure";
import {
  DEFAULT_NARRATION_VOICE,
  narrationVoiceProfile,
  narrationVoiceProfiles
} from "@/lib/voice-profiles";
import { VIDEO_FPS } from "@/video/config";
import type { ChatMessage, EditChange, EditPlan, GenerationOptions, NarrationVoice, ProductionSettings, Project, ProjectListItem, ProjectVersion, ProjectVersionPreview, ProjectVersionSummary, RenderJob, Scene, SceneAsset, SceneTransitionKind } from "@/lib/types";

type Source = "database" | "empty" | "mock";
type Stage = "brief" | "generating" | "projects" | "studio";
type Engine = "ai" | "heuristic";
type StudioView = "preview" | "storyboard";
type MediaGenerationResponse = {
  project?: Project;
  error?: string;
  requestedSceneNumbers?: number[];
  completedSceneNumbers?: number[];
  failedSceneNumbers?: number[];
};
type InvalidRenderMedia = {
  sceneNumber: number;
  type: "visual" | "audio";
  reason: string;
};
type GenerationIssueMedia = "visual" | "audio" | "clip";
type GenerationMediaIssue = {
  sceneNumber: number;
  type: GenerationIssueMedia;
  reason: string;
};
type StoryboardGenerationResponse = {
  status?: "pending" | "ready" | "failed";
  project?: Project;
  messages?: ChatMessage[];
  engine?: Engine;
  error?: string;
  recovered?: boolean;
};
type BusyAction =
  | "planning-edit"
  | "refining-edit"
  | "applying-edit"
  | "generating-images"
  | "generating-candidate"
  | "previewing-plan"
  | "generating-video"
  | "generating-audio"
  | "saving-scene"
  | "editing-timeline"
  | "saving-production"
  | "uploading-asset"
  | "restoring-version";
const promptExamples = [
  "生成一个 30 秒的 AI 视频生成平台产品介绍视频，风格高级、节奏快、适合官网首屏。",
  "做一个关于跨境电商库存管理 SaaS 的解释视频，目标客户是运营负责人。",
  "制作一个教育产品宣传视频，展示老师如何用 AI 快速生成课程内容。"
];
const transitionOptions: Array<{ value: SceneTransitionKind; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "cut", label: "硬切" },
  { value: "dissolve", label: "叠化" },
  { value: "push-left", label: "向左推进" },
  { value: "push-right", label: "向右推进" },
  { value: "zoom", label: "缩放" },
  { value: "wipe", label: "擦除" }
];

const baseProgressSteps = [
  "解析视频目标",
  "拆分场景和镜头",
  "撰写旁白与字幕",
  "生成视觉和运动提示词",
  "生成场景画面",
  "生成自然配音",
  "保存项目版本"
];

function generationProgressSteps(motion: GenerationOptions["motion"]) {
  return motion === "key-scenes"
    ? [...baseProgressSteps.slice(0, -1), "生成关键动态镜头", baseProgressSteps.at(-1)!]
    : baseProgressSteps;
}

function elapsedGenerationLabel(startedAt?: number, now = Date.now()) {
  if (!startedAt || startedAt > now) return "刚刚开始";
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes} 分 ${String(rest).padStart(2, "0")} 秒`;
}

function durationLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}:${String(rest).padStart(2, "0")}` : `0:${String(rest).padStart(2, "0")}`;
}

function productionSecondsLabel(seconds: number) {
  const rounded = Math.max(1, Math.round(seconds));
  return durationLabel(rounded);
}

function renderJobStatus(job: RenderJob) {
  if (job.status === "ready") return "已完成";
  if (job.status === "running") return `合成中 ${job.progress}%`;
  if (job.status === "queued") return "等待中";
  if (job.status === "cancelled") return "已取消";
  return "失败";
}

function renderJobTime(job: RenderJob) {
  if (!job.createdAt) return "刚刚";
  return new Date(job.createdAt).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function uniqueRegenerate(plan: EditPlan) {
  const structural = plan.sceneStructure?.operation === "split" || plan.sceneStructure?.operation === "merge-next"
    ? ["image", "audio", "thumbnail", "caption", "render"] as SceneAsset["type"][]
    : [];
  return Array.from(new Set([...plan.changes.flatMap((change) => change.regenerate), ...structural]))
    .map(assetTypeLabel)
    .join("、");
}

function planScopeLabel(plan: EditPlan, sceneCount: number) {
  const targetScenes = Array.from(new Set(plan.affectedScenes)).sort((a, b) => a - b);
  if (targetScenes.length === 0) return "只调整全片设置";
  if (targetScenes.length === sceneCount && sceneCount > 1) return `覆盖全片 ${sceneCount} 个场景`;
  if (targetScenes.length === 1) return `只影响场景 ${targetScenes[0]}`;
  return `影响场景 ${targetScenes.join("、")}`;
}

function planAssetWorkLabel(plan: EditPlan) {
  const regenerate = uniqueRegenerate(plan);
  const settingCount = productionSettingLabels(plan.productionSettings).length;
  const structure = plan.sceneStructure ? "时间线结构" : "";
  return [regenerate ? `重做${regenerate}` : "", structure, settingCount > 0 ? `${settingCount} 项成片设置` : ""]
    .filter(Boolean)
    .join("、") || "只更新文字和版本记录";
}

function planApplyLabel(plan: EditPlan, visualPreview: { total: number; ready: number }) {
  if (plan.sceneStructure) return "应用并调整时间线";
  if (visualPreview.total > 0 && visualPreview.ready < visualPreview.total) return "应用并生成素材";
  if (uniqueRegenerate(plan)) return "应用并重做素材";
  return "应用并创建版本";
}

function planReviewChecklist(plan: EditPlan, visualPreview: { total: number; ready: number }) {
  const missingPreview = Math.max(0, visualPreview.total - visualPreview.ready);
  return [
    { label: "版本保护", value: "创建可恢复新版本", tone: "ready" },
    visualPreview.total === 0
      ? { label: "画面预览", value: "无需重做画面", tone: "ready" }
      : missingPreview === 0
        ? { label: "画面预览", value: `${visualPreview.ready} 个真实预览已就绪`, tone: "ready" }
        : { label: "画面预览", value: `${missingPreview} 个场景可先生成真实预览`, tone: "attention" },
    { label: "执行任务", value: planAssetWorkLabel(plan), tone: uniqueRegenerate(plan) || plan.sceneStructure ? "working" : "ready" }
  ] as Array<{ label: string; value: string; tone: "ready" | "working" | "attention" }>;
}

function productionSettingLabels(settings?: Partial<ProductionSettings>) {
  if (!settings) return [];
  return Object.entries(settings).map(([key, value]) => {
    if (key === "captionsEnabled") return value ? "显示字幕" : "隐藏字幕";
    if (key === "captionStyle") return `字幕样式：${value === "minimal" ? "简洁" : value === "highlight" ? "强调色" : "深色底"}`;
    if (key === "playbackRate") return `全片速度：${value}x`;
    if (key === "musicVolume") return `音乐音量：${Math.round(Number(value) * 100)}%`;
    if (key === "musicDucking") return `旁白避让：${value === "off" ? "关闭" : value === "strong" ? "明显" : "平衡"}`;
    if (key === "logoPosition") {
      const positions = { "top-left": "左上", "top-right": "右上", "bottom-left": "左下", "bottom-right": "右下" } as const;
      return `Logo 位置：${positions[value as keyof typeof positions]}`;
    }
    return `Logo 大小：${value}%`;
  });
}

function productionSummaryItems(input: {
  settings: ProductionSettings;
  durationSeconds: number;
  logo?: SceneAsset;
  music?: SceneAsset;
}) {
  const effectiveDuration = input.durationSeconds / input.settings.playbackRate;
  const caption = input.settings.captionsEnabled
    ? `字幕开启 · ${input.settings.captionStyle === "minimal" ? "简洁" : input.settings.captionStyle === "highlight" ? "强调色" : "深色底"}`
    : "字幕关闭";
  const music = input.music
    ? `音乐 ${Math.round(input.settings.musicVolume * 100)}% · ${input.settings.musicDucking === "off" ? "不避让" : input.settings.musicDucking === "strong" ? "强避让" : "平衡避让"}`
    : "未添加背景音乐";
  const logo = input.logo
    ? `Logo ${input.settings.logoSize}% · ${productionSettingLabels({ logoPosition: input.settings.logoPosition })[0].replace("Logo 位置：", "")}`
    : "未添加 Logo";
  return [
    { label: "导出时长", value: productionSecondsLabel(effectiveDuration), detail: `${input.settings.playbackRate}x 播放速度` },
    { label: "字幕", value: caption, detail: input.settings.captionsEnabled ? "随旁白逐句显示" : "画面不叠加字幕" },
    { label: "声音", value: music, detail: input.music ? "导出时自动混音" : "仅保留旁白音轨" },
    { label: "品牌", value: logo, detail: input.logo ? "导出时叠加到画面" : "不叠加品牌标识" }
  ];
}

function sceneStructureLabel(mutation?: EditPlan["sceneStructure"]) {
  if (!mutation) return undefined;
  if (mutation.operation === "set-duration") return `场景 ${mutation.sceneNumber} 调整为 ${mutation.durationSeconds} 秒`;
  if (mutation.operation === "set-transition") {
    const label = transitionOptions.find((option) => option.value === mutation.kind)?.label ?? mutation.kind;
    return `场景 ${mutation.sceneNumber} 进入转场：${label}${mutation.kind === "cut" ? "" : ` · ${mutation.durationSeconds} 秒`}`;
  }
  if (mutation.operation === "set-visual") return `场景 ${mutation.sceneNumber} 采用新的候选画面`;
  if (mutation.operation === "move") return `场景 ${mutation.sceneNumber} 向${mutation.direction === "earlier" ? "前" : "后"}移动一位`;
  if (mutation.operation === "move-to") return `场景 ${mutation.sceneNumber} 移动到第 ${mutation.targetSceneNumber} 位`;
  if (mutation.operation === "split") return `拆分场景 ${mutation.sceneNumber} 为两个镜头`;
  if (mutation.operation === "merge-next") return `合并场景 ${mutation.sceneNumber} 与后一场景`;
  if (mutation.operation === "duplicate") return `复制场景 ${mutation.sceneNumber} 到下一位置`;
  return `删除场景 ${mutation.sceneNumber}`;
}

function assetTypeLabel(type: SceneAsset["type"]) {
  const labels: Record<SceneAsset["type"], string> = {
    image: "画面",
    audio: "配音",
    clip: "视频片段",
    thumbnail: "缩略图",
    caption: "字幕",
    render: "成片",
    logo: "Logo",
    music: "背景音乐"
  };
  return labels[type];
}

function compactText(text: string | undefined, fallback: string, maxLength = 72) {
  if (!text) return fallback;
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

function sceneNumberListLabel(sceneNumbers: number[]) {
  if (sceneNumbers.length === 0) return "";
  const visible = sceneNumbers.slice(0, 6).join("、");
  return sceneNumbers.length > 6 ? `${visible} 等 ${sceneNumbers.length} 个` : visible;
}

function uniqueSortedSceneNumbers(sceneNumbers: number[]) {
  return Array.from(new Set(sceneNumbers)).sort((left, right) => left - right);
}

function invalidRenderMediaSummary(items: InvalidRenderMedia[]) {
  const visual = uniqueSortedSceneNumbers(items.filter((item) => item.type === "visual").map((item) => item.sceneNumber));
  const audio = uniqueSortedSceneNumbers(items.filter((item) => item.type === "audio").map((item) => item.sceneNumber));
  return { visual, audio, all: uniqueSortedSceneNumbers([...visual, ...audio]) };
}

function withoutRepairedInvalidMedia(items: InvalidRenderMedia[], type: InvalidRenderMedia["type"], sceneNumbers?: number[]) {
  const repaired = sceneNumbers ? new Set(sceneNumbers) : undefined;
  return items.filter((item) => item.type !== type || (repaired && !repaired.has(item.sceneNumber)));
}

function generationIssueSummary(items: GenerationMediaIssue[]) {
  return {
    visual: uniqueSortedSceneNumbers(items.filter((item) => item.type === "visual").map((item) => item.sceneNumber)),
    audio: uniqueSortedSceneNumbers(items.filter((item) => item.type === "audio").map((item) => item.sceneNumber)),
    clip: uniqueSortedSceneNumbers(items.filter((item) => item.type === "clip").map((item) => item.sceneNumber))
  };
}

function withoutRepairedGenerationIssues(items: GenerationMediaIssue[], type: GenerationIssueMedia, sceneNumbers?: number[]) {
  const repaired = sceneNumbers ? new Set(sceneNumbers) : undefined;
  return items.filter((item) => item.type !== type || (repaired && !repaired.has(item.sceneNumber)));
}

function mediaCompletenessLabel(item: { sceneCount: number; visualCount: number; audioCount: number }) {
  if (item.sceneCount <= 0) return "还没有分镜";
  const visualReady = item.visualCount >= item.sceneCount;
  const audioReady = item.audioCount >= item.sceneCount;
  if (visualReady && audioReady) return "素材完整，可继续预览或导出";
  return `画面 ${item.visualCount}/${item.sceneCount} · 配音 ${item.audioCount}/${item.sceneCount}`;
}

function mediaCompletenessClass(item: { sceneCount: number; visualCount: number; audioCount: number }) {
  return item.sceneCount > 0 && item.visualCount >= item.sceneCount && item.audioCount >= item.sceneCount
    ? "complete"
    : "partial";
}

function versionMediaSummary(version: ProjectVersion) {
  return {
    sceneCount: version.scenes.length,
    visualCount: version.scenes.filter(sceneHasVisualAsset).length,
    audioCount: version.scenes.filter(sceneHasAudioAsset).length
  };
}

function versionOutputLabel(version: ProjectVersion) {
  if (version.renderUrl) return "已有 MP4 成片";
  if (version.status === "rendering" || version.renderJobId) return "成片合成中";
  const summary = versionMediaSummary(version);
  return mediaCompletenessClass(summary) === "complete" ? "可重新导出 MP4" : "恢复后需补齐素材";
}

function fileSizeLabel(value: unknown) {
  const bytes = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "云端素材";
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
  return `${(bytes / 1_000_000).toFixed(bytes >= 10_000_000 ? 0 : 1)} MB`;
}

function decimalSecondsLabel(value: unknown) {
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return `${seconds.toFixed(seconds >= 10 ? 1 : 2)} 秒`;
}

function renderJobQualityLabel(job: RenderJob) {
  if (job.status !== "ready") return undefined;
  return job.metadata?.quality === "passed" ? "成片质检通过" : "成片已生成";
}

function renderJobMetadataItems(job: RenderJob) {
  if (job.status !== "ready" || !job.metadata) return [];
  const metadata = job.metadata;
  const duration = decimalSecondsLabel(metadata.duration);
  const expectedDuration = decimalSecondsLabel(metadata.expectedDuration);
  const size = fileSizeLabel(metadata.size);
  const dimensions = Number.isFinite(Number(metadata.width)) && Number.isFinite(Number(metadata.height))
    ? `${metadata.width}×${metadata.height}`
    : undefined;
  const fps = Number.isFinite(Number(metadata.fps)) ? `${Number(metadata.fps).toFixed(0)} fps` : undefined;
  const codec = typeof metadata.videoCodec === "string" && metadata.videoCodec ? metadata.videoCodec.toUpperCase() : undefined;
  const audioTracks = Number.isFinite(Number(metadata.audioTrackCount)) ? `${metadata.audioTrackCount} 条音轨` : undefined;
  return [
    duration && expectedDuration ? `时长 ${duration} / 目标 ${expectedDuration}` : duration ? `时长 ${duration}` : "",
    size !== "云端素材" ? size : "",
    [dimensions, fps].filter(Boolean).join(" · "),
    [codec, audioTracks].filter(Boolean).join(" · ")
  ].filter(Boolean);
}

function exportActionLabel(input: {
  exportProgress?: number;
  renderUrl?: string;
  missingVisualCount: number;
  missingAudioCount: number;
  invalidMediaCount?: number;
}) {
  if (input.exportProgress !== undefined) return `正在合成 MP4 ${input.exportProgress}%`;
  if (input.invalidMediaCount && input.invalidMediaCount > 0) return `先修复 ${input.invalidMediaCount} 个异常素材`;
  if (input.missingVisualCount > 0 && input.missingAudioCount > 0) {
    return `缺 ${input.missingVisualCount} 个画面 · ${input.missingAudioCount} 段配音`;
  }
  if (input.missingVisualCount > 0) return `缺 ${input.missingVisualCount} 个画面`;
  if (input.missingAudioCount > 0) return `缺 ${input.missingAudioCount} 段配音`;
  return input.renderUrl ? "下载 MP4" : "导出 MP4";
}

function sceneVisualAsset(scene: Scene) {
  return scene.assets.find((asset) => ["image", "clip"].includes(asset.type) && asset.url);
}

function sceneHasMotionAsset(scene: Scene) {
  return scene.assets.some((asset) => asset.type === "clip" && Boolean(asset.url));
}

function sceneMediaState(scene: Scene) {
  const visualReady = sceneHasVisualAsset(scene);
  const audioReady = sceneHasAudioAsset(scene);
  const motionReady = sceneHasMotionAsset(scene);
  return {
    visualReady,
    audioReady,
    motionReady,
    ready: visualReady && audioReady
  };
}

function sceneMediaStatusLabel(scene: Scene) {
  const state = sceneMediaState(scene);
  if (state.ready && state.motionReady) return "素材完整 · 已有动态镜头";
  if (state.ready) return "素材完整 · 可预览导出";
  const missing = [
    state.visualReady ? "" : "缺画面",
    state.audioReady ? "" : "缺配音"
  ].filter(Boolean);
  return missing.join(" · ");
}

function requestErrorMessage(error: unknown, fallback: string) {
  if (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name)) {
    return `${fallback}请求超时，请稍后重试。`;
  }
  return error instanceof Error ? error.message : fallback;
}

function readPendingGenerationSession() {
  try {
    return parsePendingGenerationSession(window.sessionStorage.getItem(PENDING_GENERATION_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

function savePendingGenerationSession(session: PendingGenerationSession) {
  try {
    window.sessionStorage.setItem(PENDING_GENERATION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Generation still works when browser storage is unavailable; only refresh recovery is disabled.
  }
}

function clearPendingGenerationSession() {
  try {
    window.sessionStorage.removeItem(PENDING_GENERATION_STORAGE_KEY);
  } catch {
    // Ignore unavailable browser storage.
  }
}

async function waitForRenderJob(
  jobId: string,
  isCancelled: () => boolean = () => false,
  onProgress: (progress: number) => void = () => undefined
) {
  const startedAt = Date.now();
  let consecutiveFailures = 0;
  let current: RenderJob | undefined;
  while (!isCancelled()) {
    if (Date.now() - startedAt > 45 * 60 * 1000) {
      throw new Error("视频渲染超时，请稍后在项目中重试导出。");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
    if (isCancelled()) return undefined;
    try {
      const response = await fetch(`/api/render-jobs?id=${encodeURIComponent(jobId)}`, { cache: "no-store" });
      const data = await response.json() as { renderJob?: RenderJob; error?: string };
      if (!response.ok || !data.renderJob) throw new Error(data.error || "无法读取视频渲染进度。");
      current = data.renderJob;
      onProgress(current.progress);
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= 4) throw error;
      continue;
    }
    if (current.status !== "queued" && current.status !== "running") return current;
  }
  return undefined;
}

async function waitForGenerationRequest(
  requestId: string,
  onWaiting: () => void
): Promise<Required<Pick<StoryboardGenerationResponse, "project" | "messages" | "engine">> & StoryboardGenerationResponse> {
  const startedAt = Date.now();
  let consecutiveFailures = 0;
  onWaiting();
  while (Date.now() - startedAt < 4 * 60 * 1000) {
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
    try {
      const response = await fetch(
        `/api/projects/generation?requestId=${encodeURIComponent(requestId)}`,
        { cache: "no-store", signal: AbortSignal.timeout(12_000) }
      );
      const data = await response.json().catch(() => ({})) as StoryboardGenerationResponse;
      if (response.status === 202 || data.status === "pending") {
        consecutiveFailures = 0;
        continue;
      }
      if (!response.ok || data.status === "failed") {
        throw new Error(data.error || "视频脚本和分镜生成没有完成，请重试。");
      }
      if (!data.project || !Array.isArray(data.messages) || !data.engine) {
        throw new Error("生成任务返回的数据不完整，请重试。");
      }
      return { ...data, project: data.project, messages: data.messages, engine: data.engine };
    } catch (error) {
      if (error instanceof Error && /没有完成|数据不完整/.test(error.message)) throw error;
      consecutiveFailures += 1;
      if (consecutiveFailures >= 5) {
        throw new Error("暂时无法读取后台生成进度。项目完成后仍会保存在项目列表中，请稍后查看。");
      }
    }
  }
  throw new Error("脚本和分镜生成时间较长。任务仍可能在后台完成，请稍后到项目列表查看。");
}

function busyActionLabel(action?: BusyAction) {
  switch (action) {
    case "planning-edit":
      return "正在理解要求并生成逐场景修改方案";
    case "refining-edit":
      return "正在根据补充要求细化当前修改方案";
    case "applying-edit":
      return "正在保存新版本并更新受影响素材";
    case "generating-images":
      return "正在生成场景画面，请保持页面打开";
    case "generating-candidate":
      return "正在生成候选画面，当前视频不会被替换";
    case "previewing-plan":
      return "正在生成修改后的真实画面预览，当前视频保持不变";
    case "generating-video":
      return "正在生成动态视频镜头，请保持页面打开";
    case "generating-audio":
      return "正在生成自然配音，请保持页面打开";
    case "saving-scene":
      return "正在保存场景并创建可恢复版本";
    case "editing-timeline":
      return "正在调整时间线并创建可恢复版本";
    case "saving-production":
      return "正在保存成片设置";
    case "uploading-asset":
      return "正在上传并应用场景素材";
    case "restoring-version":
      return "正在恢复历史版本";
    default:
      return "正在处理";
  }
}

function projectStatusBadges(project: Project, source: Source) {
  const version = project.currentVersion;
  const saved = source === "database"
    ? { label: "项目已保存", tone: "ready" }
    : source === "empty"
      ? { label: "尚未创建项目", tone: "attention" }
      : { label: "本地预览", tone: "neutral" };
  const storyboard = version.scenes.length > 0
    ? { label: `${version.scenes.length} 个分镜`, tone: "ready" }
    : { label: "等待分镜", tone: "attention" };
  const media = version.assetStatus === "ready"
    ? { label: "素材完整", tone: "ready" }
    : version.assetStatus === "partial"
      ? { label: "素材待补齐", tone: "attention" }
      : version.assetStatus === "pending"
        ? { label: "素材生成中", tone: "working" }
        : { label: "素材待生成", tone: "attention" };
  const output = version.renderUrl
    ? { label: "MP4 已就绪", tone: "ready" }
    : version.status === "rendering" || version.renderJobId
      ? { label: "成片合成中", tone: "working" }
      : version.assetStatus === "ready"
        ? { label: "可导出 MP4", tone: "ready" }
        : { label: "暂不可导出", tone: "neutral" };
  return [saved, storyboard, media, output] as Array<{ label: string; tone: "ready" | "working" | "attention" | "neutral" }>;
}

function Shell({
  children,
  project,
  source,
  stage,
  onNewVideo,
  onOpenProjects,
  onOpenStudio
}: {
  children: React.ReactNode;
  project: Project;
  source: Source;
  stage: Stage;
  onNewVideo: () => void;
  onOpenProjects: () => void;
  onOpenStudio: () => void;
}) {
  const appRef = useRef<HTMLElement>(null);
  useEffect(() => {
    appRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [stage]);
  const statusBadges = projectStatusBadges(project, source);

  return (
    <main className="kv-shell">
      <aside className="kv-sidebar">
        <div className="kv-logo">K</div>
        <nav className="kv-nav">
          <button aria-label="新建视频" className={stage === "brief" ? "active" : ""} onClick={onNewVideo} type="button">
            <Plus size={18} />
          </button>
          <button aria-label="视频工作室" className={stage === "studio" ? "active" : ""} disabled={source === "empty"} onClick={onOpenStudio} type="button">
            <Clapperboard size={18} />
          </button>
          <button aria-label="项目列表" className={stage === "projects" ? "active" : ""} onClick={onOpenProjects} type="button">
            <Layers3 size={18} />
          </button>
        </nav>
      </aside>
      <section className="kv-app" ref={appRef}>
        <header className="kv-topbar">
          <div>
            <span className="kv-eyebrow">Know Video 智能视频工作室</span>
            <h1>{stage === "brief" ? "用一句需求，完成一支视频" : stage === "projects" ? "我的视频项目" : project.title}</h1>
          </div>
          <div className="kv-status-row">
            {statusBadges.map((badge) => (
              <span className={badge.tone} key={`${badge.tone}-${badge.label}`}>{badge.label}</span>
            ))}
          </div>
        </header>
        {children}
      </section>
    </main>
  );
}

function ProjectLibrary({
  projects,
  query,
  isLoading,
  onQueryChange,
  onOpen,
  onCreate,
  onRename,
  onDelete,
  actionBusy,
  errorMessage
}: {
  projects: ProjectListItem[];
  query: string;
  isLoading: boolean;
  onQueryChange: (value: string) => void;
  onOpen: (projectId: string) => void;
  onCreate: () => void;
  onRename: (projectId: string, title: string) => Promise<boolean>;
  onDelete: (projectId: string) => Promise<boolean>;
  actionBusy: boolean;
  errorMessage?: string;
}) {
  const [renamingId, setRenamingId] = useState<string>();
  const [renameValue, setRenameValue] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<ProjectListItem>();
  const filtered = projects.filter((item) => item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const statusLabel: Record<ProjectListItem["status"], string> = {
    draft: "草稿",
    planning: "规划中",
    rendering: "渲染中",
    ready: "可播放",
    failed: "需处理"
  };

  return (
    <div className="kv-projects-page">
      <div className="kv-projects-heading">
        <div>
          <span className="kv-eyebrow">项目库</span>
          <h2>继续创作，或开始一支新视频</h2>
          <p>所有脚本、分镜、素材、对话和历史版本都保存在各自项目中。</p>
        </div>
        <button className="kv-primary" onClick={onCreate} type="button">
          <Plus size={18} />
          新建视频
        </button>
      </div>
      <div className="kv-project-search">
        <Search size={18} />
        <input aria-label="搜索项目" onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索视频项目" value={query} />
        <span>{filtered.length} 个项目</span>
      </div>
      {errorMessage ? <div className="kv-inline-error" role="alert"><AlertCircle size={18} />{errorMessage}</div> : null}
      {isLoading ? (
        <div className="kv-project-empty"><Loader2 className="kv-spin" size={24} /><p>正在读取项目...</p></div>
      ) : filtered.length === 0 ? (
        <div className="kv-project-empty">
          <FolderOpen size={28} />
          <h3>{query ? "没有匹配的项目" : "还没有视频项目"}</h3>
          <p>{query ? "换一个关键词试试。" : "从一句需求开始创建你的第一支视频。"}</p>
        </div>
      ) : (
        <div className="kv-project-grid">
          {filtered.map((item) => (
            <article className="kv-project-card" key={item.id}>
              <button className="kv-project-open" disabled={actionBusy || renamingId === item.id} onClick={() => onOpen(item.id)} type="button">
                <div className={`kv-project-cover${item.thumbnailUrl ? "" : " empty"}`} style={item.thumbnailUrl ? { backgroundImage: `url(${item.thumbnailUrl})` } : undefined}>
                  {!item.thumbnailUrl ? <Film size={28} /> : null}
                  <span>{durationLabel(item.durationSeconds)}</span>
                </div>
                <div className="kv-project-card-body">
                  <div>
                    <strong>{item.title}</strong>
                    <span className={`kv-project-status ${item.status}`}>{statusLabel[item.status]}</span>
                  </div>
                  <p>{item.sceneCount} 个场景 · {new Date(item.updatedAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric" })}</p>
                  <small className={mediaCompletenessClass(item)}>
                    {mediaCompletenessLabel(item)}
                  </small>
                </div>
              </button>
              {renamingId === item.id ? (
                <form className="kv-project-rename" onSubmit={async (event) => {
                  event.preventDefault();
                  if (await onRename(item.id, renameValue.trim())) setRenamingId(undefined);
                }}>
                  <input aria-label="项目名称" autoFocus maxLength={120} onChange={(event) => setRenameValue(event.target.value)} value={renameValue} />
                  <button disabled={actionBusy || renameValue.trim().length === 0} title="保存名称" type="submit"><Check size={15} /></button>
                  <button disabled={actionBusy} onClick={() => setRenamingId(undefined)} title="取消" type="button"><X size={15} /></button>
                </form>
              ) : (
                <div className="kv-project-card-actions">
                  <button disabled={actionBusy} onClick={() => { setRenamingId(item.id); setRenameValue(item.title); }} title="重命名" type="button"><Pencil size={15} /></button>
                  <button disabled={actionBusy} onClick={() => setDeleteCandidate(item)} title="删除项目" type="button"><Trash2 size={15} /></button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {deleteCandidate ? (
        <div className="kv-modal-backdrop" role="presentation">
          <section aria-labelledby="delete-project-title" aria-modal="true" className="kv-confirm-modal" role="dialog">
            <div className="kv-confirm-icon"><Trash2 size={20} /></div>
            <h3 id="delete-project-title">删除“{deleteCandidate.title}”？</h3>
            <p>项目、全部版本、场景素材、对话记录和已导出视频都会永久删除。</p>
            <div>
              <button disabled={actionBusy} onClick={() => setDeleteCandidate(undefined)} type="button">取消</button>
              <button className="danger" disabled={actionBusy} onClick={async () => {
                if (await onDelete(deleteCandidate.id)) setDeleteCandidate(undefined);
              }} type="button">
                {actionBusy ? <Loader2 className="kv-spin" size={16} /> : <Trash2 size={16} />}
                确认删除
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function BriefScreen({
  prompt,
  options,
  isBusy,
  currentProject,
  onPromptChange,
  onOptionsChange,
  onUseExample,
  onSubmit,
  onOpenStudio,
  hasCurrentProject,
  errorMessage
}: {
  prompt: string;
  options: GenerationOptions;
  isBusy: boolean;
  currentProject: Project;
  onPromptChange: (value: string) => void;
  onOptionsChange: (value: GenerationOptions) => void;
  onUseExample: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onOpenStudio: () => void;
  hasCurrentProject: boolean;
  errorMessage?: string;
}) {
  return (
    <div className="kv-brief">
      <section className="kv-brief-main">
        <div className="kv-section-heading">
          <span className="kv-pill">文字生成视频</span>
          <h2>描述你想做的视频，脚本、分镜、画面和动态预览一次完成。</h2>
        </div>
        <form className="kv-prompt-box" onSubmit={onSubmit}>
          <textarea
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="例如：生成一个 30 秒产品介绍视频，展示用户输入需求、AI 自动分镜、生成视频并能聊天修改..."
            value={prompt}
          />
          <div className="kv-generation-options">
            <label>
              <span>视频时长</span>
              <select onChange={(event) => onOptionsChange({ ...options, duration: event.target.value as GenerationOptions["duration"] })} value={options.duration}>
                <option value="15">15 秒</option>
                <option value="30">30 秒</option>
                <option value="45">45 秒</option>
                <option value="60">60 秒</option>
              </select>
            </label>
            <label>
              <span>场景数量</span>
              <select onChange={(event) => onOptionsChange({ ...options, sceneCount: event.target.value as GenerationOptions["sceneCount"] })} value={options.sceneCount}>
                <option value="auto">自动规划</option>
                <option value="3">3 个场景</option>
                <option value="5">5 个场景</option>
                <option value="6">6 个场景</option>
              </select>
            </label>
            <label>
              <span>旁白语言</span>
              <select onChange={(event) => onOptionsChange({ ...options, language: event.target.value as GenerationOptions["language"] })} value={options.language}>
                <option value="中文">中文</option>
                <option value="英文">英文</option>
              </select>
            </label>
            <label>
              <span>视觉风格</span>
              <select onChange={(event) => onOptionsChange({ ...options, style: event.target.value as GenerationOptions["style"] })} value={options.style}>
                <option value="电影质感">电影质感</option>
                <option value="极简高级">极简高级</option>
                <option value="明快有活力">明快有活力</option>
                <option value="温暖自然">温暖自然</option>
              </select>
            </label>
            <label>
              <span>动态方式</span>
              <select onChange={(event) => onOptionsChange({ ...options, motion: event.target.value as GenerationOptions["motion"] })} value={options.motion}>
                <option value="key-scenes">关键镜头动态</option>
                <option value="camera">智能运镜</option>
              </select>
            </label>
          </div>
          <div className="kv-prompt-tools">
            <span>{options.motion === "key-scenes"
              ? `${Number(options.duration) >= 45 && options.sceneCount !== "3" ? "2" : "1"} 个动作最强的场景将生成动态视频，其余场景使用智能运镜。`
              : "全部场景使用画面运镜，生成更快。"}</span>
            <button className="kv-primary" disabled={isBusy || prompt.trim().length < 4} type="submit">
              {isBusy ? <Loader2 className="kv-spin" size={18} /> : <Sparkles size={18} />}
              开始生成
            </button>
          </div>
        </form>
        {errorMessage ? (
          <div className="kv-inline-error" role="alert">
            <AlertCircle size={18} />
            <span>{errorMessage}</span>
          </div>
        ) : null}
        <div className="kv-example-grid">
          {promptExamples.map((example) => (
            <button key={example} onClick={() => onUseExample(example)} type="button">
              <span>{example}</span>
              <ArrowRight size={16} />
            </button>
          ))}
        </div>
      </section>
      <aside className="kv-brief-side">
        <div className="kv-side-panel">
          <span className="kv-eyebrow">最近项目</span>
          {hasCurrentProject ? (
            <>
              <h3>{currentProject.title}</h3>
              <p>{currentProject.currentVersion.scenes.length} 个场景 · {durationLabel(currentProject.currentVersion.durationSeconds)}</p>
              <button onClick={onOpenStudio} type="button">
                打开工作室
                <ChevronRight size={16} />
              </button>
            </>
          ) : (
            <>
              <h3>还没有视频项目</h3>
              <p>输入一句需求，创建第一支可继续对话修改的视频。</p>
            </>
          )}
        </div>
        <div className="kv-side-panel">
          <span className="kv-eyebrow">制作流程</span>
          <ol className="kv-mini-steps">
            <li>理解需求并完成脚本与分镜</li>
            <li>为每个场景生成独立视觉素材</li>
            <li>组合为可播放的动态预览</li>
            <li>通过对话逐场景修改并保留版本</li>
          </ol>
        </div>
      </aside>
    </div>
  );
}

function GeneratingScreen({
  prompt,
  progress,
  status,
  motion,
  startedAt
}: {
  prompt: string;
  progress: number;
  status: string;
  motion: GenerationOptions["motion"];
  startedAt?: number;
}) {
  const steps = generationProgressSteps(motion);
  const activeIndex = Math.min(steps.length - 1, Math.floor(progress / (100 / steps.length)));
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="kv-generating">
      <div className="kv-render-orbit">
        <Film size={44} />
        <span />
      </div>
      <div className="kv-section-heading centered">
        <span className="kv-pill">正在制作</span>
        <h2>{status}</h2>
        <p>{prompt}</p>
      </div>
      <div className="kv-progress">
        <div style={{ width: `${progress}%` }} />
      </div>
      <div className="kv-generation-status-strip" role="status">
        <span><strong>{elapsedGenerationLabel(startedAt, now)}</strong><small>已用时间</small></span>
        <span><strong>{Math.min(activeIndex + 1, steps.length)} / {steps.length}</strong><small>当前步骤</small></span>
        <span><strong>自动恢复</strong><small>刷新后继续找回任务</small></span>
      </div>
      <div className="kv-progress-steps">
        {steps.map((step, index) => (
          <div className={index <= activeIndex ? "done" : ""} key={step}>
            {index < activeIndex ? <Check size={16} /> : index === activeIndex ? <Loader2 className="kv-spin" size={16} /> : <span />}
            <p>{step}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Storyboard({
  scenes,
  selectedScene,
  isBusy,
  onSelect,
  onMutate,
  onRegenerate,
  onRegenerateAudio,
  onGenerateClip
}: {
  scenes: Scene[];
  selectedScene: number;
  isBusy: boolean;
  onSelect: (scene: number) => void;
  onMutate: (mutation: SceneStructureMutation) => void;
  onRegenerate: (sceneNumbers?: number[]) => void;
  onRegenerateAudio: (sceneNumbers?: number[]) => void;
  onGenerateClip: (sceneNumber: number) => void;
}) {
  const scene = scenes.find((item) => item.sceneNumber === selectedScene) ?? scenes[0];
  const selectedMediaState = scene ? sceneMediaState(scene) : undefined;
  const [duration, setDuration] = useState(scene?.durationSeconds ?? 5);
  const [transitionKind, setTransitionKind] = useState<SceneTransitionKind>(scene?.style.transition?.kind ?? "auto");
  const [transitionDuration, setTransitionDuration] = useState(scene?.style.transition?.durationSeconds ?? 0.5);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draggedSceneNumber, setDraggedSceneNumber] = useState<number>();
  const [dropTargetSceneNumber, setDropTargetSceneNumber] = useState<number>();
  const dragSourceRef = useRef<number>();
  const dragTargetRef = useRef<number>();

  useEffect(() => {
    setDuration(scene?.durationSeconds ?? 5);
    setTransitionKind(scene?.style.transition?.kind ?? "auto");
    setTransitionDuration(scene?.style.transition?.durationSeconds ?? 0.5);
    setConfirmDelete(false);
  }, [scene?.id, scene?.durationSeconds, scene?.style.transition?.durationSeconds, scene?.style.transition?.kind]);

  const savedTransitionKind = scene?.style.transition?.kind ?? "auto";
  const savedTransitionDuration = scene?.style.transition?.durationSeconds ?? 0.5;
  const transitionChanged = transitionKind !== savedTransitionKind
    || (transitionKind !== "cut" && transitionDuration !== savedTransitionDuration);

  function clearDragState() {
    dragSourceRef.current = undefined;
    dragTargetRef.current = undefined;
    setDraggedSceneNumber(undefined);
    setDropTargetSceneNumber(undefined);
  }

  function setDragState(sourceSceneNumber: number, targetSceneNumber = sourceSceneNumber) {
    dragSourceRef.current = sourceSceneNumber;
    dragTargetRef.current = targetSceneNumber;
    setDraggedSceneNumber(sourceSceneNumber);
    setDropTargetSceneNumber(targetSceneNumber);
  }

  function startDrag(event: DragEvent<HTMLButtonElement>, sceneNumber: number) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(sceneNumber));
    setDragState(sceneNumber);
  }

  function dropScene(event: DragEvent<HTMLButtonElement>, targetSceneNumber: number) {
    event.preventDefault();
    const sourceSceneNumber = draggedSceneNumber ?? Number(event.dataTransfer.getData("text/plain"));
    clearDragState();
    if (!Number.isInteger(sourceSceneNumber) || sourceSceneNumber === targetSceneNumber) return;
    onMutate({ operation: "move-to", sceneNumber: sourceSceneNumber, targetSceneNumber });
  }

  function updatePointerTarget(clientX: number, clientY: number) {
    const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-scene-number]");
    const sceneNumber = Number(target?.dataset.sceneNumber);
    if (!Number.isInteger(sceneNumber) || sceneNumber === dragTargetRef.current) return;
    dragTargetRef.current = sceneNumber;
    setDropTargetSceneNumber(sceneNumber);
  }

  function startPointerDrag(event: ReactPointerEvent<HTMLSpanElement>, sceneNumber: number) {
    if (isBusy) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState(sceneNumber);
  }

  function movePointerDrag(event: ReactPointerEvent<HTMLSpanElement>) {
    if (dragSourceRef.current === undefined) return;
    event.preventDefault();
    updatePointerTarget(event.clientX, event.clientY);
  }

  function finishPointerDrag(event: ReactPointerEvent<HTMLSpanElement>) {
    const sourceSceneNumber = dragSourceRef.current;
    const targetSceneNumber = dragTargetRef.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    clearDragState();
    if (sourceSceneNumber === undefined || targetSceneNumber === undefined || sourceSceneNumber === targetSceneNumber) return;
    onMutate({ operation: "move-to", sceneNumber: sourceSceneNumber, targetSceneNumber });
  }

  return (
    <section className="kv-storyboard">
      <div className="kv-strip-heading">
        <h3>分镜时间线</h3>
        <span>{scenes.length} 个场景</span>
      </div>
      {scene ? (
        <>
        <div className="kv-scene-readiness-card">
          <div>
            <strong>S{scene.sceneNumber} · {sceneMediaStatusLabel(scene)}</strong>
            <span>画面、配音齐全后才能稳定预览和导出；动态镜头可让关键场景更像真实视频。</span>
          </div>
          <div>
            <button disabled={isBusy || selectedMediaState?.visualReady} onClick={() => onRegenerate([scene.sceneNumber])} type="button">
              {isBusy ? <Loader2 className="kv-spin" size={15} /> : <ImagePlus size={15} />}
              {selectedMediaState?.visualReady ? "画面已就绪" : "生成本场景画面"}
            </button>
            <button disabled={isBusy || selectedMediaState?.audioReady} onClick={() => onRegenerateAudio([scene.sceneNumber])} type="button">
              {isBusy ? <Loader2 className="kv-spin" size={15} /> : <Mic2 size={15} />}
              {selectedMediaState?.audioReady ? "配音已就绪" : "生成本场景配音"}
            </button>
            <button disabled={isBusy || !selectedMediaState?.visualReady} onClick={() => onGenerateClip(scene.sceneNumber)} type="button">
              {isBusy ? <Loader2 className="kv-spin" size={15} /> : <Clapperboard size={15} />}
              {selectedMediaState?.motionReady ? "重做动态镜头" : "生成动态镜头"}
            </button>
          </div>
        </div>
        <div className="kv-timeline-controls">
          <strong>S{scene.sceneNumber}</strong>
          <label>
            <Clock3 size={15} />
            <span>时长</span>
            <input
              aria-label={`场景 ${scene.sceneNumber} 时长`}
              disabled={isBusy}
              max="20"
              min="2"
              onChange={(event) => setDuration(Number(event.target.value))}
              type="number"
              value={duration}
            />
            <span>秒</span>
          </label>
          <button
            disabled={isBusy || duration === scene.durationSeconds || !Number.isInteger(duration) || duration < 2 || duration > 20}
            onClick={() => onMutate({ operation: "set-duration", sceneNumber: scene.sceneNumber, durationSeconds: duration })}
            type="button"
          >
            <Check size={15} />更新时长
          </button>
          {scene.sceneNumber > 1 ? (
            <>
              <span className="kv-timeline-divider" />
              <label className="kv-transition-control">
                <Sparkles size={15} />
                <span>进入转场</span>
                <select
                  aria-label={`场景 ${scene.sceneNumber} 进入转场`}
                  disabled={isBusy}
                  onChange={(event) => {
                    const nextKind = event.target.value as SceneTransitionKind;
                    setTransitionKind(nextKind);
                    if (nextKind !== "cut" && transitionDuration < 0.2) setTransitionDuration(0.5);
                  }}
                  value={transitionKind}
                >
                  {transitionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="kv-transition-control">
                <span>时长</span>
                <select
                  aria-label={`场景 ${scene.sceneNumber} 转场时长`}
                  disabled={isBusy || transitionKind === "cut"}
                  onChange={(event) => setTransitionDuration(Number(event.target.value))}
                  value={transitionDuration}
                >
                  {![0.25, 0.5, 0.75, 1].includes(transitionDuration) ? (
                    <option value={transitionDuration}>{transitionDuration} 秒</option>
                  ) : null}
                  <option value="0.25">0.25 秒</option>
                  <option value="0.5">0.5 秒</option>
                  <option value="0.75">0.75 秒</option>
                  <option value="1">1 秒</option>
                </select>
              </label>
              <button
                disabled={isBusy || !transitionChanged}
                onClick={() => onMutate({
                  operation: "set-transition",
                  sceneNumber: scene.sceneNumber,
                  kind: transitionKind,
                  durationSeconds: transitionKind === "cut" ? 0 : transitionDuration
                })}
                type="button"
              >
                <Check size={15} />应用转场
              </button>
            </>
          ) : <span className="kv-opening-scene-label">开场镜头</span>}
          <span className="kv-timeline-divider" />
          <button aria-label="向前移动场景" disabled={isBusy || scene.sceneNumber === 1} onClick={() => onMutate({ operation: "move", sceneNumber: scene.sceneNumber, direction: "earlier" })} title="向前移动" type="button"><ArrowLeft size={16} /></button>
          <button aria-label="向后移动场景" disabled={isBusy || scene.sceneNumber === scenes.length} onClick={() => onMutate({ operation: "move", sceneNumber: scene.sceneNumber, direction: "later" })} title="向后移动" type="button"><ArrowRight size={16} /></button>
          <label className="kv-move-to-control">
            <span>移到</span>
            <select
              aria-label={`场景 ${scene.sceneNumber} 目标位置`}
              disabled={isBusy}
              onChange={(event) => {
                const targetSceneNumber = Number(event.target.value);
                if (targetSceneNumber !== scene.sceneNumber) {
                  onMutate({ operation: "move-to", sceneNumber: scene.sceneNumber, targetSceneNumber });
                }
              }}
              value={scene.sceneNumber}
            >
              {scenes.map((item) => <option key={item.id} value={item.sceneNumber}>第 {item.sceneNumber} 位</option>)}
            </select>
          </label>
          <button
            aria-label="拆分当前场景"
            disabled={isBusy || scenes.length >= 20 || scene.durationSeconds < 4 || scene.voiceover.trim().length < 8}
            onClick={() => onMutate({ operation: "split", sceneNumber: scene.sceneNumber })}
            title="按旁白拆分为两个镜头"
            type="button"
          ><Scissors size={16} /></button>
          <button
            aria-label="与后一场景合并"
            disabled={isBusy || scene.sceneNumber === scenes.length || scene.durationSeconds + (scenes[scene.sceneNumber]?.durationSeconds ?? 0) > 20}
            onClick={() => onMutate({ operation: "merge-next", sceneNumber: scene.sceneNumber })}
            title="与后一场景合并"
            type="button"
          ><Combine size={16} /></button>
          <button aria-label="复制场景" disabled={isBusy || scenes.length >= 20} onClick={() => onMutate({ operation: "duplicate", sceneNumber: scene.sceneNumber })} title="复制场景" type="button"><Copy size={16} /></button>
          {confirmDelete ? (
            <div className="kv-delete-confirm">
              <span>删除 S{scene.sceneNumber}？</span>
              <button disabled={isBusy} onClick={() => onMutate({ operation: "delete", sceneNumber: scene.sceneNumber })} type="button">确认</button>
              <button aria-label="取消删除" disabled={isBusy} onClick={() => setConfirmDelete(false)} title="取消" type="button"><X size={15} /></button>
            </div>
          ) : (
            <button aria-label="删除场景" className="danger" disabled={isBusy || scenes.length <= 1} onClick={() => setConfirmDelete(true)} title="删除场景" type="button"><Trash2 size={16} /></button>
          )}
        </div>
        </>
      ) : null}
      <div className="kv-scene-strip">
        {scenes.map((scene) => {
          const mediaState = sceneMediaState(scene);
          return (
          <button
            aria-label={`场景 ${scene.sceneNumber} ${scene.title}，拖动可调整顺序`}
            className={[
              scene.sceneNumber === selectedScene ? "active" : "",
              !mediaState.ready ? "needs-media" : "",
              scene.sceneNumber === draggedSceneNumber ? "dragging" : "",
              scene.sceneNumber === dropTargetSceneNumber && scene.sceneNumber !== draggedSceneNumber ? "drop-target" : ""
            ].filter(Boolean).join(" ")}
            draggable={!isBusy}
            data-scene-number={scene.sceneNumber}
            key={scene.id}
            onDragEnd={clearDragState}
            onDragOver={(event) => {
              if (isBusy || draggedSceneNumber === undefined) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropTargetSceneNumber(scene.sceneNumber);
            }}
            onDragStart={(event) => startDrag(event, scene.sceneNumber)}
            onDrop={(event) => dropScene(event, scene.sceneNumber)}
            onClick={() => onSelect(scene.sceneNumber)}
            type="button"
          >
            <span
              aria-hidden="true"
              className="kv-drag-handle"
              onPointerCancel={clearDragState}
              onPointerDown={(event) => startPointerDrag(event, scene.sceneNumber)}
              onPointerMove={movePointerDrag}
              onPointerUp={finishPointerDrag}
              title="拖动调整顺序"
            ><GripVertical size={15} /></span>
            {scene.assets.find((asset) => asset.type === "image" && asset.url) ? (
              <span
                className="kv-scene-thumb"
                style={{ backgroundImage: `url("${scene.assets.find((asset) => asset.type === "image" && asset.url)?.url}")` }}
              />
            ) : scene.assets.some((asset) => asset.type === "clip" && asset.url)
              ? <span className="kv-scene-thumb empty clip"><FileVideo2 size={18} /></span>
              : <span className="kv-scene-thumb empty"><ImagePlus size={18} /></span>}
            <span className="kv-scene-number">S{scene.sceneNumber}</span>
            <strong>{scene.title}</strong>
            <small>{scene.durationSeconds} 秒</small>
            <span className={`kv-scene-media-status ${mediaState.ready ? "ready" : "partial"}`}>
              {sceneMediaStatusLabel(scene)}
            </span>
          </button>
          );
        })}
      </div>
    </section>
  );
}

type SceneTextEdits = Pick<Scene, "title" | "voiceover" | "visualPrompt" | "motionPrompt">;

function ScenePanel({
  scene,
  isBusy,
  onSave,
  onVoiceChange
}: {
  scene?: Scene;
  isBusy: boolean;
  onSave: (sceneNumber: number, edits: SceneTextEdits) => void;
  onVoiceChange: (sceneNumber: number, voice: NarrationVoice) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SceneTextEdits>({ title: "", voiceover: "", visualPrompt: "", motionPrompt: "" });
  const [selectedVoice, setSelectedVoice] = useState<NarrationVoice>(DEFAULT_NARRATION_VOICE);
  const imageMetadata = scene?.assets.find((asset) => asset.type === "image")?.metadata;
  const qualityLabel = imageMetadata?.quality === "premium"
    || String(imageMetadata?.model ?? "").includes("klein-9b")
    ? "精细画质"
    : "标准画质";

  useEffect(() => {
    if (!scene) return;
    setDraft({
      title: scene.title,
      voiceover: scene.voiceover,
      visualPrompt: scene.visualPrompt,
      motionPrompt: scene.motionPrompt
    });
    setSelectedVoice(scene.style.narrationVoice ?? DEFAULT_NARRATION_VOICE);
    setEditing(false);
  }, [scene?.id]);

  const changed = Boolean(scene) && (
    draft.title.trim() !== scene?.title
    || draft.voiceover.trim() !== scene?.voiceover
    || draft.visualPrompt.trim() !== scene?.visualPrompt
    || draft.motionPrompt.trim() !== scene?.motionPrompt
  );
  const voiceChanged = Boolean(scene) && selectedVoice !== (scene?.style.narrationVoice ?? DEFAULT_NARRATION_VOICE);
  const voiceProfile = narrationVoiceProfile(selectedVoice);

  return (
    <section className="kv-scene-panel" id="kv-scene-panel">
      <div className="kv-strip-heading">
        <div className="kv-scene-heading-copy">
          <h3>{editing ? `编辑场景 ${scene?.sceneNumber ?? ""}` : "场景制作说明"}</h3>
          <span>{scene?.style.theme ?? "theme"} · {qualityLabel}</span>
        </div>
        {scene ? (
          <div className="kv-scene-panel-actions">
            <label className="kv-voice-picker">
              <span>配音音色</span>
              <select
                aria-label="当前场景配音音色"
                disabled={isBusy}
                onChange={(event) => setSelectedVoice(event.target.value as NarrationVoice)}
                value={selectedVoice}
              >
                {narrationVoiceProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.label}</option>
                ))}
              </select>
            </label>
            <button
              disabled={isBusy || !voiceChanged}
              onClick={() => onVoiceChange(scene.sceneNumber, selectedVoice)}
              title={voiceProfile.description}
              type="button"
            >
              {isBusy ? <Loader2 className="kv-spin" size={15} /> : <Mic2 size={15} />}
              应用音色
            </button>
            <button disabled={isBusy} onClick={() => setEditing((current) => !current)} type="button">
              {editing ? <RotateCcw size={15} /> : <Pencil size={15} />}
              {editing ? "取消编辑" : "直接编辑"}
            </button>
          </div>
        ) : null}
      </div>
      {editing && scene ? (
        <div className="kv-scene-editor">
          <label className="wide">
            <span>场景标题</span>
            <input onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} value={draft.title} />
          </label>
          <label>
            <span>旁白</span>
            <textarea onChange={(event) => setDraft((current) => ({ ...current, voiceover: event.target.value }))} value={draft.voiceover} />
          </label>
          <label>
            <span>画面设计</span>
            <textarea onChange={(event) => setDraft((current) => ({ ...current, visualPrompt: event.target.value }))} value={draft.visualPrompt} />
          </label>
          <label className="wide">
            <span>镜头运动</span>
            <textarea onChange={(event) => setDraft((current) => ({ ...current, motionPrompt: event.target.value }))} value={draft.motionPrompt} />
          </label>
          <div className="kv-scene-editor-actions">
            <p>保存会创建新版本，并只重做受影响的画面或配音。</p>
            <button
              className="kv-primary"
              disabled={isBusy || !changed || Object.values(draft).some((value) => value.trim().length === 0)}
              onClick={() => onSave(scene.sceneNumber, {
                title: draft.title.trim(),
                voiceover: draft.voiceover.trim(),
                visualPrompt: draft.visualPrompt.trim(),
                motionPrompt: draft.motionPrompt.trim()
              })}
              type="button"
            >
              {isBusy ? <Loader2 className="kv-spin" size={16} /> : <Check size={16} />}
              保存为新版本
            </button>
          </div>
        </div>
      ) : (
        <div className="kv-scene-grid">
          <article>
            <span>旁白</span>
            <p>{scene?.voiceover ?? "No voiceover yet."}</p>
          </article>
          <article>
            <span>画面设计</span>
            <p>{scene?.visualPrompt ?? "No visual prompt yet."}</p>
          </article>
          <article>
            <span>镜头运动</span>
            <p>{scene?.motionPrompt ?? "No motion prompt yet."}</p>
          </article>
        </div>
      )}
    </section>
  );
}

function StoryboardBoard({ scenes }: { scenes: Scene[] }) {
  return (
    <section className="kv-board">
      {scenes.map((scene) => (
        <article key={scene.id}>
          {scene.assets.find((asset) => asset.type === "image" && asset.url) ? (
            <div
              className="kv-board-image"
              style={{ backgroundImage: `url("${scene.assets.find((asset) => asset.type === "image" && asset.url)?.url}")` }}
            />
          ) : scene.assets.some((asset) => asset.type === "clip" && asset.url)
            ? <div className="kv-board-image empty clip"><FileVideo2 size={24} /><span>已使用视频片段</span></div>
            : <div className="kv-board-image empty"><ImagePlus size={24} /><span>等待生成画面</span></div>}
          <div>
            <span>S{scene.sceneNumber}</span>
            <strong>{scene.title}</strong>
            <small>{scene.durationSeconds}s</small>
          </div>
          <p>{scene.voiceover}</p>
          <ul>
            <li>{compactText(scene.visualPrompt, "Visual prompt", 120)}</li>
            <li>{compactText(scene.motionPrompt, "Motion prompt", 120)}</li>
          </ul>
        </article>
      ))}
    </section>
  );
}

function VisualCandidateComparison({
  scene,
  initialCandidateId,
  isBusy,
  onClose,
  onAdopt
}: {
  scene: Scene;
  initialCandidateId: string;
  isBusy: boolean;
  onClose: () => void;
  onAdopt: (assetId: string) => void;
}) {
  const candidates = scene.assets.filter((asset) => asset.type === "thumbnail" && asset.metadata?.candidate === true && asset.url);
  const currentImage = scene.assets.find((asset) => asset.type === "image" && asset.url);
  const initialIndex = Math.max(0, candidates.findIndex((asset) => asset.id === initialCandidateId));
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const selected = candidates[Math.min(selectedIndex, Math.max(0, candidates.length - 1))];

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (candidates.length > 0 && event.key === "ArrowLeft") setSelectedIndex((index) => (index - 1 + candidates.length) % candidates.length);
      if (candidates.length > 0 && event.key === "ArrowRight") setSelectedIndex((index) => (index + 1) % candidates.length);
      if (event.key === "Tab") {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [candidates.length, onClose]);

  if (!currentImage || !selected) return null;
  const selectCandidate = (direction: -1 | 1) => {
    setSelectedIndex((index) => (index + direction + candidates.length) % candidates.length);
  };

  return (
    <div className="kv-modal-backdrop kv-visual-compare-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }} role="presentation">
      <section aria-labelledby="visual-compare-title" aria-modal="true" className="kv-visual-compare" ref={dialogRef} role="dialog">
        <header>
          <div>
            <span className="kv-eyebrow">场景 {scene.sceneNumber} · 视觉对比</span>
            <h3 id="visual-compare-title">选择更合适的场景画面</h3>
          </div>
          <button aria-label="关闭画面对比" onClick={onClose} ref={closeRef} title="关闭" type="button"><X size={19} /></button>
        </header>
        <div className="kv-visual-compare-stage">
          <figure>
            <figcaption><span>当前画面</span><small>视频正在使用</small></figcaption>
            <div style={{ backgroundImage: `url("${currentImage.url}")` }} />
          </figure>
          <ArrowRight aria-hidden="true" className="kv-visual-compare-arrow" size={22} />
          <figure>
            <figcaption><span>候选画面</span><small aria-live="polite">{selectedIndex + 1} / {candidates.length}</small></figcaption>
            <div style={{ backgroundImage: `url("${selected.url}")` }} />
          </figure>
        </div>
        <div className="kv-visual-compare-details">
          <div>
            <strong>{scene.title}</strong>
            <p>{compactText(String(selected.metadata?.candidateInstruction ?? scene.visualPrompt), scene.visualPrompt, 190)}</p>
          </div>
          <div className="kv-visual-candidate-nav" aria-label="切换候选画面">
            <button aria-label="上一张候选画面" disabled={candidates.length < 2} onClick={() => selectCandidate(-1)} title="上一张" type="button"><ArrowLeft size={17} /></button>
            <div>{candidates.map((candidate, index) => (
              <button aria-label={`查看候选画面 ${index + 1}`} className={index === selectedIndex ? "active" : ""} key={candidate.id} onClick={() => setSelectedIndex(index)} type="button" />
            ))}</div>
            <button aria-label="下一张候选画面" disabled={candidates.length < 2} onClick={() => selectCandidate(1)} title="下一张" type="button"><ArrowRight size={17} /></button>
          </div>
        </div>
        <footer>
          <p>采用后会创建可恢复的新版本，当前版本仍保留在历史记录中。</p>
          <div>
            <button disabled={isBusy} onClick={onClose} type="button">继续比较</button>
            <button className="kv-primary" disabled={isBusy} onClick={() => onAdopt(selected.id)} type="button"><Check size={17} />采用这张画面</button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function SceneAssetsPanel({
  scene,
  isBusy,
  uploadProgress,
  onGenerateCandidate,
  onAdoptCandidate,
  openComparisonId,
  onComparisonOpened,
  onUpload,
  onRemove
}: {
  scene: Scene;
  isBusy: boolean;
  uploadProgress?: number;
  onGenerateCandidate: (instruction?: string) => void;
  onAdoptCandidate: (assetId: string) => void;
  openComparisonId?: string;
  onComparisonOpened: () => void;
  onUpload: () => void;
  onRemove: (assetId: string) => void;
}) {
  const assets = scene.assets.filter((asset) => ["image", "thumbnail", "clip", "audio"].includes(asset.type));
  const candidateCount = assets.filter((asset) => asset.type === "thumbnail" && asset.metadata?.candidate === true).length;
  const hasCurrentImage = assets.some((asset) => asset.type === "image" && asset.url);
  const [comparisonId, setComparisonId] = useState<string>();
  const [candidateComposerOpen, setCandidateComposerOpen] = useState(false);
  const [candidateInstruction, setCandidateInstruction] = useState("");
  useEffect(() => {
    setComparisonId(undefined);
    setCandidateComposerOpen(false);
    setCandidateInstruction("");
  }, [scene.id]);
  useEffect(() => {
    if (!openComparisonId) return;
    const available = assets.some((asset) => asset.id === openComparisonId && asset.type === "thumbnail" && asset.metadata?.candidate === true);
    if (!available) return;
    setComparisonId(openComparisonId);
    onComparisonOpened();
  }, [assets, onComparisonOpened, openComparisonId]);
  return (
    <>
    <section className="kv-assets-panel">
      <div className="kv-strip-heading">
        <div>
          <span className="kv-eyebrow">场景 {scene.sceneNumber} 素材</span>
          <h3>管理当前画面、视频片段和配音</h3>
        </div>
        <div className="kv-assets-actions">
          <button
            aria-expanded={candidateComposerOpen}
            disabled={isBusy || candidateCount >= 3 || !hasCurrentImage}
            onClick={() => setCandidateComposerOpen((open) => !open)}
            title={!hasCurrentImage ? "请先生成当前场景画面" : candidateCount >= 3 ? "请先移除一张候选画面" : "按要求生成新画面但不替换当前版本"}
            type="button"
          >
            <Sparkles size={16} />
            改造画面 · {candidateCount}/3
          </button>
          <button disabled={isBusy} onClick={onUpload} type="button">
            {uploadProgress !== undefined ? <Loader2 className="kv-spin" size={16} /> : <Upload size={16} />}
            {uploadProgress !== undefined ? `上传 ${uploadProgress}%` : "添加或替换"}
          </button>
        </div>
      </div>
      {candidateComposerOpen ? (
        <form className="kv-candidate-composer" onSubmit={(event) => {
          event.preventDefault();
          onGenerateCandidate(candidateInstruction.trim() || "保持主体与叙事不变，优化构图、光影和空间层次，使画面更精致。");
          setCandidateComposerOpen(false);
        }}>
          <div>
            <label htmlFor={`candidate-instruction-${scene.id}`}>这张画面要怎么改？</label>
            <span>{candidateInstruction.length}/600</span>
          </div>
          <textarea
            autoFocus
            id={`candidate-instruction-${scene.id}`}
            maxLength={600}
            onChange={(event) => setCandidateInstruction(event.target.value)}
            placeholder="例如：保持人物和构图不变，改成明亮自然光，去掉画面中的文字。"
            value={candidateInstruction}
          />
          <div className="kv-candidate-presets" aria-label="快捷视觉修改">
            {["整体更明亮通透", "去掉画面内的文字", "突出主体，弱化背景", "增强电影级光影"].map((preset) => (
              <button key={preset} onClick={() => setCandidateInstruction(preset)} type="button">{preset}</button>
            ))}
          </div>
          <footer>
            <p>只生成候选，不改变当前视频。</p>
            <div>
              <button onClick={() => setCandidateComposerOpen(false)} type="button">取消</button>
              <button className="kv-primary" disabled={isBusy} type="submit"><Sparkles size={16} />生成候选画面</button>
            </div>
          </footer>
        </form>
      ) : null}
      <div className="kv-asset-list">
        {assets.length === 0 ? (
          <div className="kv-assets-empty"><ImagePlus size={20} />这个场景还没有可用素材</div>
        ) : assets.map((asset) => (
          <article key={asset.id}>
            {asset.type === "image" || asset.type === "thumbnail" ? (
              <span className="kv-asset-preview" style={{ backgroundImage: `url("${asset.url}")` }} />
            ) : (
              <span className="kv-asset-preview icon">
                {asset.type === "clip" ? <FileVideo2 size={22} /> : <Music2 size={22} />}
              </span>
            )}
            <div>
              <strong>{String(asset.metadata?.name ?? (asset.type === "image" ? "当前画面" : asset.type === "thumbnail" ? "候选画面" : asset.type === "clip" ? "视频片段" : "场景配音"))}</strong>
              <span>{asset.type === "image" ? "使用中" : asset.type === "thumbnail" ? "可对比采用" : asset.type === "clip" ? "视频" : "音频"} · {fileSizeLabel(asset.metadata?.size)}</span>
            </div>
            <div className="kv-asset-actions">
              {asset.type === "thumbnail" && asset.metadata?.candidate === true ? (
                <button className="compare" disabled={isBusy} onClick={() => setComparisonId(asset.id)} title="与当前画面大图对比" type="button">
                  <Eye size={15} />对比
                </button>
              ) : null}
              {asset.type === "thumbnail" && asset.metadata?.candidate === true ? (
                <button className="adopt" disabled={isBusy} onClick={() => onAdoptCandidate(asset.id)} title="采用为当前画面并创建新版本" type="button">
                  <Check size={15} />采用
                </button>
              ) : null}
              <button aria-label={`移除 ${String(asset.metadata?.name ?? asset.type)}`} className="remove" disabled={isBusy} onClick={() => onRemove(asset.id)} title="从当前版本移除" type="button">
                <Trash2 size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
    {comparisonId ? (
      <VisualCandidateComparison
        initialCandidateId={comparisonId}
        isBusy={isBusy}
        onAdopt={(assetId) => {
          setComparisonId(undefined);
          onAdoptCandidate(assetId);
        }}
        onClose={() => setComparisonId(undefined)}
        scene={scene}
      />
    ) : null}
    </>
  );
}

function ProductionSettingsPanel({
  settings,
  logo,
  music,
  durationSeconds,
  isBusy,
  uploadProgress,
  uploadType,
  onChange,
  onUpload,
  onRemove
}: {
  settings: ProductionSettings;
  logo?: SceneAsset;
  music?: SceneAsset;
  durationSeconds: number;
  isBusy: boolean;
  uploadProgress?: number;
  uploadType?: "logo" | "music";
  onChange: (settings: Partial<ProductionSettings>) => void;
  onUpload: (type: "logo" | "music") => void;
  onRemove: (type: "logo" | "music") => void;
}) {
  const [musicVolume, setMusicVolume] = useState(settings.musicVolume);
  const [logoSize, setLogoSize] = useState(settings.logoSize);
  const summary = productionSummaryItems({ settings, durationSeconds, logo, music });

  useEffect(() => setMusicVolume(settings.musicVolume), [settings.musicVolume]);
  useEffect(() => setLogoSize(settings.logoSize), [settings.logoSize]);

  return (
    <section className="kv-production-panel">
      <div className="kv-strip-heading">
        <div>
          <span className="kv-eyebrow">成片设置</span>
          <h3>字幕、节奏、品牌与背景音乐</h3>
        </div>
        <span>预览与 MP4 同步</span>
      </div>
      <div className="kv-production-summary" aria-label="成片输出摘要">
        {summary.map((item) => (
          <span key={item.label}>
            <small>{item.label}</small>
            <strong>{item.value}</strong>
            <em>{item.detail}</em>
          </span>
        ))}
      </div>
      <div className="kv-production-grid">
        <div className="kv-production-control">
          <div className="kv-production-control-title"><Captions size={17} /><strong>字幕</strong></div>
          <label className="kv-switch-row">
            <span>显示逐句字幕</span>
            <input
              checked={settings.captionsEnabled}
              disabled={isBusy}
              onChange={(event) => onChange({ captionsEnabled: event.target.checked })}
              type="checkbox"
            />
          </label>
          <div className="kv-segmented" aria-label="字幕样式">
            {(["minimal", "boxed", "highlight"] as const).map((style) => (
              <button
                className={settings.captionStyle === style ? "active" : ""}
                disabled={isBusy || !settings.captionsEnabled}
                key={style}
                onClick={() => onChange({ captionStyle: style })}
                type="button"
              >
                {style === "minimal" ? "简洁" : style === "boxed" ? "深色底" : "强调色"}
              </button>
            ))}
          </div>
        </div>
        <div className="kv-production-control">
          <div className="kv-production-control-title"><SlidersHorizontal size={17} /><strong>播放速度</strong></div>
          <div className="kv-segmented" aria-label="播放速度">
            {([0.75, 1, 1.25, 1.5] as const).map((rate) => (
              <button
                className={settings.playbackRate === rate ? "active" : ""}
                disabled={isBusy}
                key={rate}
                onClick={() => onChange({ playbackRate: rate })}
                type="button"
              >{rate}x</button>
            ))}
          </div>
          <small>画面、旁白和字幕保持同步。</small>
        </div>
        <div className="kv-production-control">
          <div className="kv-production-control-title"><Music2 size={17} /><strong>背景音乐</strong></div>
          <div className="kv-production-asset-row">
            <div><strong>{String(music?.metadata?.name ?? "尚未添加")}</strong><span>{music ? fileSizeLabel(music.metadata?.size) : "MP3 或 WAV"}</span></div>
            <button disabled={isBusy} onClick={() => onUpload("music")} type="button">
              {uploadType === "music" ? <Loader2 className="kv-spin" size={15} /> : <Upload size={15} />}
              {uploadType === "music" ? `${uploadProgress ?? 0}%` : music ? "替换" : "添加"}
            </button>
            {music ? <button aria-label="移除背景音乐" disabled={isBusy} onClick={() => onRemove("music")} title="移除背景音乐" type="button"><Trash2 size={15} /></button> : null}
          </div>
          <label className="kv-range-row">
            <span>音量 {Math.round(musicVolume * 100)}%</span>
            <input
              disabled={isBusy || !music}
              max="0.5"
              min="0"
              onChange={(event) => setMusicVolume(Number(event.target.value))}
              onKeyUp={() => onChange({ musicVolume })}
              onPointerUp={() => onChange({ musicVolume })}
              step="0.02"
              type="range"
              value={musicVolume}
            />
          </label>
          <div className="kv-production-subcontrol">
            <span>旁白时自动压低音乐</span>
            <div className="kv-segmented" aria-label="旁白音乐避让">
              {(["off", "balanced", "strong"] as const).map((mode) => (
                <button
                  className={settings.musicDucking === mode ? "active" : ""}
                  disabled={isBusy || !music}
                  key={mode}
                  onClick={() => onChange({ musicDucking: mode })}
                  type="button"
                >{mode === "off" ? "关闭" : mode === "balanced" ? "平衡" : "明显"}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="kv-production-control">
          <div className="kv-production-control-title"><ImagePlus size={17} /><strong>品牌 Logo</strong></div>
          <div className="kv-production-asset-row">
            <div><strong>{String(logo?.metadata?.name ?? "尚未添加")}</strong><span>{logo ? fileSizeLabel(logo.metadata?.size) : "透明 PNG 效果最佳"}</span></div>
            <button disabled={isBusy} onClick={() => onUpload("logo")} type="button">
              {uploadType === "logo" ? <Loader2 className="kv-spin" size={15} /> : <Upload size={15} />}
              {uploadType === "logo" ? `${uploadProgress ?? 0}%` : logo ? "替换" : "添加"}
            </button>
            {logo ? <button aria-label="移除 Logo" disabled={isBusy} onClick={() => onRemove("logo")} title="移除 Logo" type="button"><Trash2 size={15} /></button> : null}
          </div>
          <div className="kv-production-inline">
            <label>位置<select disabled={isBusy || !logo} onChange={(event) => onChange({ logoPosition: event.target.value as ProductionSettings["logoPosition"] })} value={settings.logoPosition}><option value="top-left">左上</option><option value="top-right">右上</option><option value="bottom-left">左下</option><option value="bottom-right">右下</option></select></label>
            <label className="kv-range-row">
              <span>大小 {logoSize}%</span>
              <input
                disabled={isBusy || !logo}
                max="24"
                min="6"
                onChange={(event) => setLogoSize(Number(event.target.value))}
                onKeyUp={() => onChange({ logoSize })}
                onPointerUp={() => onChange({ logoSize })}
                step="1"
                type="range"
                value={logoSize}
              />
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}

function PlanVisualDiff({ change, scene, editPlanId }: { change: EditChange; scene: Scene; editPlanId: string }) {
  const image = scene.assets.find((asset) => asset.type === "image" && asset.url);
  const preview = planPreviewAsset(scene, editPlanId);
  const visualRegeneration = change.regenerate.some((type) => ["image", "clip", "thumbnail"].includes(type));
  const afterIsLight = change.after.thumbnailTone === "light";
  const beforeColor = scene.style.palette[0] ?? "#101828";
  const afterColor = afterIsLight ? "#f5f7fa" : beforeColor;

  return (
    <div className="kv-plan-visual-diff" aria-label={`场景 ${change.sceneNumber} 画面对比`}>
      <figure>
        <figcaption>当前画面</figcaption>
        <div
          className={`kv-plan-frame${image ? " has-image" : ""}`}
          style={image ? { backgroundImage: `url("${image.url}")` } : { backgroundColor: beforeColor }}
        >
          {!image ? <><span>S{change.sceneNumber}</span><strong>{change.before.title}</strong></> : null}
        </div>
      </figure>
      <ArrowRight aria-hidden="true" size={16} />
      <figure>
        <figcaption>修改后</figcaption>
        <div
          className={`kv-plan-frame after${preview || (!visualRegeneration && image) ? " has-image" : ""}${afterIsLight && !preview ? " light" : ""}`}
          style={preview
            ? { backgroundImage: `url("${preview.url}")` }
            : !visualRegeneration && image
              ? { backgroundImage: `url("${image.url}")` }
              : { backgroundColor: afterColor }}
        >
          {preview ? <span className="kv-plan-preview-ready"><Check size={13} />真实预览</span> : visualRegeneration ? (
            <><ImagePlus size={18} /><strong>{change.after.title}</strong><small>确认后生成新画面</small></>
          ) : (
            <><Check size={18} /><strong>沿用当前画面</strong></>
          )}
        </div>
      </figure>
    </div>
  );
}

function ChangeCard({ change, scene, editPlanId }: { change: EditChange; scene?: Scene; editPlanId: string }) {
  const changedFields = [
    {
      label: "标题",
      before: change.before.title,
      after: change.after.title
    },
    {
      label: "旁白",
      before: change.before.voiceover,
      after: change.after.voiceover
    },
    {
      label: "配音音色",
      before: narrationVoiceProfile(change.before.narrationVoice).label,
      after: narrationVoiceProfile(change.after.narrationVoice).label
    },
    {
      label: "画面方向",
      before: change.before.visualPrompt,
      after: change.after.visualPrompt
    },
    {
      label: "镜头运动",
      before: change.before.motionPrompt,
      after: change.after.motionPrompt
    }
  ].filter((field) => field.after && field.after !== field.before);

  return (
    <article className="kv-change">
      <div className="kv-change-heading">
        <div>
          <strong>场景 {change.sceneNumber}</strong>
          <span>{change.status === "updated" ? "已更新" : change.status === "added" ? "新增" : change.status === "deleted" ? "删除" : "未改动"}</span>
        </div>
        {change.regenerate.length > 0 ? (
          <div className="kv-regenerate-tags" aria-label="需要重新生成的素材">
            {Array.from(new Set(change.regenerate)).map((type) => (
              <span key={type}>{assetTypeLabel(type)}</span>
            ))}
          </div>
        ) : null}
      </div>
      {scene ? <PlanVisualDiff change={change} editPlanId={editPlanId} scene={scene} /> : null}
      <div className="kv-change-diffs">
        {changedFields.map((field) => (
          <section className={field.label === "旁白" ? "accent" : ""} key={field.label}>
            <span>{field.label}</span>
            <div className="kv-before-after">
              <div>
                <small>当前</small>
                <p>{compactText(field.before, "无", field.label === "画面方向" ? 110 : 88)}</p>
              </div>
              <ArrowRight aria-hidden="true" size={15} />
              <div>
                <small>修改后</small>
                <p>{compactText(field.after, "无", field.label === "画面方向" ? 110 : 88)}</p>
              </div>
            </div>
          </section>
        ))}
      </div>
      <details className="kv-change-details">
        <summary>查看完整制作说明</summary>
        <dl>
          <div><dt>标题</dt><dd>{change.after.title}</dd></div>
          {change.after.voiceover ? <div><dt>旁白</dt><dd>{change.after.voiceover}</dd></div> : null}
          <div><dt>画面方向</dt><dd>{change.after.visualPrompt}</dd></div>
          {change.after.motionPrompt ? <div><dt>镜头运动</dt><dd>{change.after.motionPrompt}</dd></div> : null}
        </dl>
      </details>
    </article>
  );
}

function StructureSceneCard({
  scene,
  title,
  durationSeconds,
  willRegenerate = false
}: {
  scene?: Scene;
  title: string;
  durationSeconds: number;
  willRegenerate?: boolean;
}) {
  const image = !willRegenerate ? scene?.assets.find((asset) => asset.type === "image" && asset.url) : undefined;
  return (
    <div
      className={`kv-structure-scene${image ? " has-image" : ""}${willRegenerate ? " regenerating" : ""}`}
      style={image ? { backgroundImage: `url("${image.url}")` } : undefined}
    >
      {willRegenerate ? <ImagePlus size={16} /> : null}
      <strong>{title}</strong>
      <span>{durationSeconds} 秒{willRegenerate ? " · 更新画面与配音" : ""}</span>
    </div>
  );
}

function StructurePlanPreview({ plan, scenes }: { plan: EditPlan; scenes: Scene[] }) {
  const mutation = plan.sceneStructure;
  if (!mutation || (mutation.operation !== "split" && mutation.operation !== "merge-next")) return null;
  const source = scenes.find((scene) => scene.sceneNumber === mutation.sceneNumber);
  if (!source) return null;

  if (mutation.operation === "split") {
    const split = sceneSplitPreview(source);
    return (
      <div className="kv-structure-preview" aria-label={`场景 ${mutation.sceneNumber} 拆分预览`}>
        <div><small>当前</small><StructureSceneCard durationSeconds={source.durationSeconds} scene={source} title={source.title} /></div>
        <ArrowRight aria-hidden="true" size={16} />
        <div>
          <small>拆分后</small>
          <div className="kv-structure-stack">
            <StructureSceneCard durationSeconds={split.first.durationSeconds} title={split.first.title} willRegenerate />
            <StructureSceneCard durationSeconds={split.second.durationSeconds} title={split.second.title} willRegenerate />
          </div>
        </div>
      </div>
    );
  }

  const next = scenes.find((scene) => scene.sceneNumber === mutation.sceneNumber + 1);
  if (!next) return null;
  return (
    <div className="kv-structure-preview" aria-label={`场景 ${mutation.sceneNumber} 合并预览`}>
      <div>
        <small>当前</small>
        <div className="kv-structure-stack">
          <StructureSceneCard durationSeconds={source.durationSeconds} scene={source} title={source.title} />
          <StructureSceneCard durationSeconds={next.durationSeconds} scene={next} title={next.title} />
        </div>
      </div>
      <ArrowRight aria-hidden="true" size={16} />
      <div>
        <small>合并后</small>
        <StructureSceneCard
          durationSeconds={source.durationSeconds + next.durationSeconds}
          title={/\p{Script=Han}/u.test(source.title + next.title) ? `${source.title}与${next.title}` : `${source.title} + ${next.title}`}
          willRegenerate
        />
      </div>
    </div>
  );
}

function ChatPanel({
  messages,
  scenes,
  pendingPlan,
  input,
  isBusy,
  busyAction,
  onInput,
  onSubmit,
  onPreview,
  onApply,
  onCancel
}: {
  messages: ChatMessage[];
  scenes: Scene[];
  pendingPlan?: EditPlan;
  input: string;
  isBusy: boolean;
  busyAction?: BusyAction;
  onInput: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPreview: () => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const visualSceneNumbers = pendingPlan ? editPlanVisualSceneNumbers(pendingPlan) : [];
  const previewedSceneNumbers = pendingPlan ? visualSceneNumbers.filter((sceneNumber) => {
    const scene = scenes.find((item) => item.sceneNumber === sceneNumber);
    return scene && planPreviewAsset(scene, pendingPlan.id);
  }) : [];
  const planModificationCount = pendingPlan
    ? pendingPlan.changes.length + productionSettingLabels(pendingPlan.productionSettings).length + (pendingPlan.sceneStructure ? 1 : 0)
    : 0;
  const visualPreviewState = { total: visualSceneNumbers.length, ready: previewedSceneNumbers.length };
  const applyLabel = pendingPlan ? planApplyLabel(pendingPlan, visualPreviewState) : "应用修改";
  const checklist = pendingPlan ? planReviewChecklist(pendingPlan, visualPreviewState) : [];

  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
  }, [messages.length, pendingPlan, isBusy]);

  return (
    <aside className="kv-chat" id="kv-chat-panel">
      <header>
        <div>
          <span className="kv-eyebrow">对话式改片</span>
          <h3>告诉我你想怎么改</h3>
        </div>
        <PanelRightOpen size={20} />
      </header>
      <div className="kv-chat-log" ref={logRef}>
        {messages.map((message) => (
          <div className={`kv-msg ${message.role}`} key={message.id}>
            <p>{message.content}</p>
            {message.editPlan ? (
              <div className="kv-plan-summary">
                <span>{message.editPlan.affectedScenes.length > 0 ? `影响场景：${message.editPlan.affectedScenes.join(", ")}` : "作用范围：全片设置"}</span>
                <span>{uniqueRegenerate(message.editPlan) ? `重新生成：${uniqueRegenerate(message.editPlan)}` : "无需重做场景素材"}</span>
              </div>
            ) : null}
          </div>
        ))}
        {pendingPlan ? (
          <section className="kv-review-plan">
            <div className="kv-strip-heading">
              <h3>确认修改方案</h3>
              <span>{planModificationCount} 项修改</span>
            </div>
            <div className="kv-plan-state" role="status">
              <div>
                <Clock3 size={16} />
                <strong>方案待确认，当前视频还没有被改动</strong>
              </div>
              <p>确认后才会创建新版本并生成受影响素材；继续输入会先调整这个方案。</p>
              <div className="kv-plan-state-grid">
                <span><strong>{planScopeLabel(pendingPlan, scenes.length)}</strong><small>作用范围</small></span>
                <span><strong>{planAssetWorkLabel(pendingPlan)}</strong><small>确认后执行</small></span>
              </div>
              <div className="kv-plan-checklist" aria-label="执行前检查">
                {checklist.map((item) => (
                  <span className={item.tone} key={item.label}>
                    <Check size={13} />
                    <strong>{item.value}</strong>
                    <small>{item.label}</small>
                  </span>
                ))}
              </div>
            </div>
            <p>{pendingPlan.summary}</p>
            {pendingPlan.sceneStructure ? (
              <>
                <div className="kv-structure-plan" aria-label="时间线结构修改">
                  <Layers3 size={17} />
                  <div><strong>时间线结构</strong><span>{sceneStructureLabel(pendingPlan.sceneStructure)}</span></div>
                </div>
                <StructurePlanPreview plan={pendingPlan} scenes={scenes} />
              </>
            ) : null}
            {productionSettingLabels(pendingPlan.productionSettings).length > 0 ? (
              <div className="kv-production-plan" aria-label="全片设置修改">
                <strong>全片设置</strong>
                <div>{productionSettingLabels(pendingPlan.productionSettings).map((label) => <span key={label}>{label}</span>)}</div>
              </div>
            ) : null}
            <div className="kv-change-list">
              {pendingPlan.changes.map((change) => (
                <ChangeCard
                  change={change}
                  editPlanId={pendingPlan.id}
                  key={change.sceneNumber}
                  scene={scenes.find((scene) => scene.sceneNumber === change.sceneNumber)}
                />
              ))}
            </div>
            <div className="kv-review-actions">
              {visualSceneNumbers.length > 0 ? (
                <button className="kv-preview-plan" disabled={isBusy || previewedSceneNumbers.length === visualSceneNumbers.length} onClick={onPreview} type="button">
                  {isBusy && busyAction === "previewing-plan" ? <Loader2 className="kv-spin" size={16} /> : previewedSceneNumbers.length === visualSceneNumbers.length ? <Check size={16} /> : <Eye size={16} />}
                  {previewedSceneNumbers.length === visualSceneNumbers.length
                    ? `真实预览已就绪 · ${previewedSceneNumbers.length} 个场景`
                    : `生成真实预览 · ${visualSceneNumbers.length - previewedSceneNumbers.length} 个场景`}
                </button>
              ) : null}
              <button className="kv-primary" disabled={isBusy} onClick={onApply} type="button">
                {isBusy ? <Loader2 className="kv-spin" size={16} /> : <Check size={16} />}
                {applyLabel}
              </button>
              <button onClick={onCancel} type="button">取消</button>
            </div>
          </section>
        ) : null}
        {isBusy && !pendingPlan ? (
          <div className="kv-msg assistant kv-msg-loading" role="status">
            <Loader2 className="kv-spin" size={16} />
            <p>{busyActionLabel(busyAction)}</p>
          </div>
        ) : null}
      </div>
      {pendingPlan ? (
        <div className="kv-chat-draft-note" role="note">
          <div>
            <Check size={15} />
            <span>正在审核修改方案。输入补充要求会继续改方案；点击应用才会真正改片。</span>
          </div>
          <div className="kv-chat-draft-actions">
            <button className="kv-primary" disabled={isBusy} onClick={onApply} type="button">
              {isBusy ? <Loader2 className="kv-spin" size={15} /> : <Check size={15} />}
              {applyLabel}
            </button>
            <button disabled={isBusy} onClick={onCancel} type="button">取消方案</button>
          </div>
        </div>
      ) : null}
      <form className="kv-chat-form" onSubmit={onSubmit}>
        <textarea
          disabled={isBusy}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
          onChange={(event) => onInput(event.target.value)}
          placeholder={pendingPlan ? "继续调整当前方案，输入补充要求…" : "描述你想修改的场景、旁白或整体风格…"}
          value={input}
        />
        <button disabled={isBusy || input.trim().length === 0} type="submit">
          {isBusy ? <Loader2 className="kv-spin" size={18} /> : <Send size={18} />}
        </button>
      </form>
    </aside>
  );
}

function versionSceneSignature(scene?: Scene) {
  if (!scene) return "";
  return JSON.stringify({
    title: scene.title,
    voiceover: scene.voiceover,
    visualPrompt: scene.visualPrompt,
    motionPrompt: scene.motionPrompt,
    durationSeconds: scene.durationSeconds,
    style: scene.style
  });
}

function VersionSceneSide({ label, scene }: { label: string; scene?: Scene }) {
  const image = scene?.assets.find((asset) => asset.type === "image" && asset.url);
  const clip = scene?.assets.find((asset) => asset.type === "clip" && asset.url);
  return (
    <div className="kv-version-scene-side">
      <span>{label}</span>
      <div
        className={`kv-version-scene-thumb${image ? " has-image" : ""}`}
        style={image ? { backgroundImage: `url("${image.url}")` } : undefined}
      >
        {!image ? clip ? <FileVideo2 size={20} /> : <ImagePlus size={20} /> : null}
      </div>
      <strong>{scene?.title ?? "没有这个场景"}</strong>
      <small>{scene ? `${scene.durationSeconds} 秒` : "已删除"}</small>
    </div>
  );
}

function VersionComparison({ preview }: { preview: ProjectVersionPreview }) {
  const count = Math.max(preview.version.scenes.length, preview.currentVersion.scenes.length);
  const selectedSummary = versionMediaSummary(preview.version);
  const currentSummary = versionMediaSummary(preview.currentVersion);
  const rows = Array.from({ length: count }, (_, index) => {
    const before = preview.version.scenes[index];
    const after = preview.currentVersion.scenes[index];
    const status = !before ? "新增" : !after ? "删除" : versionSceneSignature(before) === versionSceneSignature(after) ? "未变化" : "已修改";
    return { sceneNumber: index + 1, before, after, status };
  });
  const changed = rows.filter((row) => row.status !== "未变化");
  const visibleRows = changed.length > 0 ? changed : rows;
  const sameVersion = preview.version.id === preview.currentVersion.id;

  return (
    <section className="kv-version-comparison" aria-label="版本场景比较">
      <div className="kv-version-comparison-summary">
        <div>
          <span>所选版本</span>
          <strong>{preview.version.scenes.length} 个场景 · {durationLabel(preview.version.durationSeconds)}</strong>
          <small className={mediaCompletenessClass(selectedSummary)}>{mediaCompletenessLabel(selectedSummary)}</small>
          <small>{versionOutputLabel(preview.version)}</small>
        </div>
        <ArrowRight size={17} />
        <div>
          <span>当前版本</span>
          <strong>{preview.currentVersion.scenes.length} 个场景 · {durationLabel(preview.currentVersion.durationSeconds)}</strong>
          <small className={mediaCompletenessClass(currentSummary)}>{mediaCompletenessLabel(currentSummary)}</small>
          <small>{versionOutputLabel(preview.currentVersion)}</small>
        </div>
      </div>
      <p>{sameVersion ? "这是当前版本的完整分镜快照。" : preview.changeSummary.description}</p>
      <div className="kv-version-scene-diffs">
        {visibleRows.map((row) => (
          <article key={`${row.sceneNumber}-${row.before?.id ?? "new"}-${row.after?.id ?? "removed"}`}>
            <header><strong>场景 {row.sceneNumber}</strong><span className={`status-${row.status}`}>{row.status}</span></header>
            <div>
              <VersionSceneSide label="所选版本" scene={row.before} />
              <ArrowRight aria-hidden="true" size={16} />
              <VersionSceneSide label="当前版本" scene={row.after} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function StudioScreen({
  project,
  messages,
  pendingPlan,
  input,
  selectedScene,
  view,
  isBusy,
  busyAction,
  onInput,
  onSubmit,
  onPreviewPlan,
  onApply,
  onCancel,
  onSelectScene,
  onViewChange,
  onUpload,
  onRegenerate,
  onEnhanceScene,
  onGenerateClip,
  onGenerateClips,
  onRegenerateAudio,
  onExport,
  exportProgress,
  activeRenderJobId,
  renderJobs,
  invalidRenderMedia,
  generationIssues,
  exportsOpen,
  exportsLoading,
  onToggleExports,
  onCancelExport,
  versions,
  versionsOpen,
  versionsLoading,
  versionPreview,
  versionPreviewLoading,
  onToggleVersions,
  onPreviewVersion,
  onCloseVersionPreview,
  onRestoreVersion,
  uploadProgress,
  assetsOpen,
  onToggleAssets,
  onRemoveAsset,
  onGenerateCandidate,
  candidateToCompare,
  onCandidateComparisonOpened,
  productionOpen,
  productionUploadType,
  onToggleProduction,
  onUpdateProduction,
  onUploadProduction,
  onRemoveProduction,
  onMutateScene,
  onSaveScene,
  onVoiceChange
}: {
  project: Project;
  messages: ChatMessage[];
  pendingPlan?: EditPlan;
  input: string;
  selectedScene: number;
  view: StudioView;
  isBusy: boolean;
  busyAction?: BusyAction;
  onInput: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPreviewPlan: () => void;
  onApply: () => void;
  onCancel: () => void;
  onSelectScene: (scene: number) => void;
  onViewChange: (view: StudioView) => void;
  onUpload: () => void;
  onRegenerate: (sceneNumbers?: number[]) => void;
  onEnhanceScene: (sceneNumber: number) => void;
  onGenerateClip: (sceneNumber: number) => void;
  onGenerateClips: (sceneNumbers: number[]) => void;
  onRegenerateAudio: (sceneNumbers?: number[]) => void;
  onExport: () => void;
  exportProgress?: number;
  activeRenderJobId?: string;
  renderJobs: RenderJob[];
  invalidRenderMedia: InvalidRenderMedia[];
  generationIssues: GenerationMediaIssue[];
  exportsOpen: boolean;
  exportsLoading: boolean;
  onToggleExports: () => void;
  onCancelExport: (jobId: string) => void;
  versions: ProjectVersionSummary[];
  versionsOpen: boolean;
  versionsLoading: boolean;
  versionPreview?: ProjectVersionPreview;
  versionPreviewLoading: boolean;
  onToggleVersions: () => void;
  onPreviewVersion: (versionId: string) => void;
  onCloseVersionPreview: () => void;
  onRestoreVersion: (versionId: string) => void;
  uploadProgress?: number;
  assetsOpen: boolean;
  onToggleAssets: () => void;
  onRemoveAsset: (assetId: string) => void;
  onGenerateCandidate: (sceneNumber: number, instruction?: string) => void;
  candidateToCompare?: { sceneNumber: number; assetId: string };
  onCandidateComparisonOpened: () => void;
  productionOpen: boolean;
  productionUploadType?: "logo" | "music";
  onToggleProduction: () => void;
  onUpdateProduction: (settings: Partial<ProductionSettings>) => void;
  onUploadProduction: (type: "logo" | "music") => void;
  onRemoveProduction: (type: "logo" | "music") => void;
  onMutateScene: (mutation: SceneStructureMutation) => void;
  onSaveScene: (sceneNumber: number, edits: SceneTextEdits) => void;
  onVoiceChange: (sceneNumber: number, voice: NarrationVoice) => void;
}) {
  const playerRef = useRef<PlayerRef>(null);
  const toolMenuRef = useRef<HTMLDivElement>(null);
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const scene = project.currentVersion.scenes.find((item) => item.sceneNumber === selectedScene) ?? project.currentVersion.scenes[0];
  const missingSceneNumbers = project.currentVersion.scenes
    .filter((item) => !sceneVisualAsset(item))
    .map((item) => item.sceneNumber);
  const missingAudioSceneNumbers = project.currentVersion.scenes
    .filter((item) => !item.assets.some((asset) => asset.type === "audio" && asset.url))
    .map((item) => item.sceneNumber);
  const invalidMedia = invalidRenderMediaSummary(invalidRenderMedia);
  const generationIssue = generationIssueSummary(generationIssues);
  const generationIssueCount = generationIssues.length;
  const filmSettings = productionSettings(project);
  useEffect(() => {
    if (!toolMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!toolMenuRef.current?.contains(event.target as Node)) setToolMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setToolMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [toolMenuOpen]);
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const handleFrameUpdate = ({ detail }: { detail: { frame: number } }) => {
      const seconds = (detail.frame / VIDEO_FPS) * filmSettings.playbackRate;
      let cursor = 0;
      const activeScene = project.currentVersion.scenes.find((item) => {
        cursor += item.durationSeconds;
        return seconds < cursor;
      }) ?? project.currentVersion.scenes.at(-1);
      if (activeScene && activeScene.sceneNumber !== selectedScene) {
        onSelectScene(activeScene.sceneNumber);
      }
    };
    player.addEventListener("frameupdate", handleFrameUpdate);
    player.addEventListener("seeked", handleFrameUpdate);
    return () => {
      player.removeEventListener("frameupdate", handleFrameUpdate);
      player.removeEventListener("seeked", handleFrameUpdate);
    };
  }, [filmSettings.playbackRate, onSelectScene, project.currentVersion.id, project.currentVersion.scenes, selectedScene]);

  function selectScene(sceneNumber: number) {
    const seconds = project.currentVersion.scenes
      .filter((item) => item.sceneNumber < sceneNumber)
      .reduce((sum, item) => sum + item.durationSeconds, 0);
    playerRef.current?.seekTo(Math.round((seconds * VIDEO_FPS) / filmSettings.playbackRate));
    onSelectScene(sceneNumber);
  }

  function runTool(action: () => void) {
    setToolMenuOpen(false);
    action();
  }

  return (
    <div className="kv-studio">
      <section className="kv-studio-main">
        {isBusy && busyAction ? (
          <div className="kv-operation-status" role="status">
            <Loader2 className="kv-spin" size={16} />
            <span>{busyActionLabel(busyAction)}</span>
          </div>
        ) : null}
        <div className="kv-actionbar">
          <div className="kv-tabs">
            <button className={view === "preview" ? "active" : ""} onClick={() => onViewChange("preview")} type="button">
              <Film size={16} />
              动态预览
            </button>
            <button className={view === "storyboard" ? "active" : ""} onClick={() => onViewChange("storyboard")} type="button">
              <Layers3 size={16} />
              分镜板
            </button>
          </div>
          <div className="kv-actions">
            <button
              className="kv-mobile-chat-action"
              onClick={() => document.getElementById("kv-chat-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              type="button"
            >
              <MessageSquareText size={16} />
              对话改片
            </button>
            <button className="kv-enhance-action" disabled={isBusy} onClick={() => onEnhanceScene(selectedScene)} type="button">
              <Sparkles size={16} />
              高清画面
            </button>
            <button
              className="kv-video-action"
              disabled={isBusy || !scene?.assets.some((asset) => asset.type === "image" && asset.url)}
              onClick={() => onGenerateClip(selectedScene)}
              type="button"
            >
              <Clapperboard size={16} />
              {scene?.assets.some((asset) => asset.type === "clip" && asset.url) ? "重做动态" : "生成动态"}
            </button>
            <div className="kv-tool-menu-wrap" ref={toolMenuRef}>
              <button
                aria-controls="kv-studio-tool-menu"
                aria-expanded={toolMenuOpen}
                className={toolMenuOpen ? "active" : ""}
                onClick={() => setToolMenuOpen((open) => !open)}
                type="button"
              >
                <MoreHorizontal size={17} />
                工具
              </button>
              {toolMenuOpen ? (
                <div aria-label="工作室工具" className="kv-tool-menu" id="kv-studio-tool-menu" role="menu">
                  <span>项目</span>
                  <button className={assetsOpen ? "active" : ""} disabled={isBusy} onClick={() => runTool(onToggleAssets)} role="menuitem" type="button">
                    {uploadProgress !== undefined ? <Loader2 className="kv-spin" size={16} /> : <ImagePlus size={16} />}
                    {uploadProgress !== undefined ? `上传 ${uploadProgress}%` : "素材库"}
                  </button>
                  <button className={productionOpen ? "active" : ""} disabled={isBusy} onClick={() => runTool(onToggleProduction)} role="menuitem" type="button">
                    <SlidersHorizontal size={16} />
                    成片设置
                  </button>
                  <button className={versionsOpen ? "active" : ""} onClick={() => runTool(onToggleVersions)} role="menuitem" type="button">
                    <History size={16} />
                    版本历史
                  </button>
                  <button className={exportsOpen ? "active" : ""} onClick={() => runTool(onToggleExports)} role="menuitem" type="button">
                    <FileVideo2 size={16} />
                    导出记录
                  </button>
                  <span>生成</span>
                  <button disabled={isBusy} onClick={() => runTool(() => onRegenerate(missingSceneNumbers.length > 0 ? missingSceneNumbers : undefined))} role="menuitem" type="button">
                    <RefreshCcw size={16} />
                    {missingSceneNumbers.length > 0 ? `补齐 ${missingSceneNumbers.length} 个画面` : "重做全部画面"}
                  </button>
                  <button disabled={isBusy} onClick={() => runTool(() => onRegenerateAudio(missingAudioSceneNumbers.length > 0 ? missingAudioSceneNumbers : [selectedScene]))} role="menuitem" type="button">
                    <Mic2 size={16} />
                    {missingAudioSceneNumbers.length > 0 ? `补齐 ${missingAudioSceneNumbers.length} 段配音` : "重做本场景配音"}
                  </button>
                </div>
              ) : null}
            </div>
            <button
              className="kv-primary"
              disabled={isBusy || exportProgress !== undefined || missingSceneNumbers.length > 0 || missingAudioSceneNumbers.length > 0 || invalidRenderMedia.length > 0}
              onClick={onExport}
              type="button"
            >
              {exportProgress !== undefined ? <Loader2 className="kv-spin" size={16} /> : <Download size={16} />}
              {exportActionLabel({
                exportProgress,
                renderUrl: project.currentVersion.renderUrl,
                missingVisualCount: missingSceneNumbers.length,
                missingAudioCount: missingAudioSceneNumbers.length,
                invalidMediaCount: invalidRenderMedia.length
              })}
            </button>
            {exportProgress !== undefined && activeRenderJobId ? (
              <button className="kv-cancel-export" onClick={() => onCancelExport(activeRenderJobId)} type="button">
                <X size={16} />
                取消
              </button>
            ) : null}
          </div>
        </div>
        {missingSceneNumbers.length > 0 || missingAudioSceneNumbers.length > 0 ? (
          <section className="kv-media-readiness" role="status" aria-label="成片素材检查">
            <div>
              <AlertCircle size={18} />
              <div>
                <strong>成片素材还没有补齐</strong>
                <span>补齐后才能导出 MP4，避免画面缺失、静音或旁白不完整。</span>
              </div>
            </div>
            <div className="kv-media-readiness-actions">
              {missingSceneNumbers.length > 0 ? (
                <button disabled={isBusy} onClick={() => onRegenerate(missingSceneNumbers)} type="button">
                  {isBusy ? <Loader2 className="kv-spin" size={15} /> : <ImagePlus size={15} />}
                  补齐画面：场景 {sceneNumberListLabel(missingSceneNumbers)}
                </button>
              ) : null}
              {missingAudioSceneNumbers.length > 0 ? (
                <button disabled={isBusy} onClick={() => onRegenerateAudio(missingAudioSceneNumbers)} type="button">
                  {isBusy ? <Loader2 className="kv-spin" size={15} /> : <Mic2 size={15} />}
                  补齐配音：场景 {sceneNumberListLabel(missingAudioSceneNumbers)}
                </button>
              ) : null}
            </div>
          </section>
        ) : null}
        {invalidRenderMedia.length > 0 ? (
          <section className="kv-media-readiness kv-media-readiness-danger" role="status" aria-label="云端素材异常">
            <div>
              <AlertCircle size={18} />
              <div>
                <strong>导出前发现云端素材异常</strong>
                <span>
                  场景 {sceneNumberListLabel(invalidMedia.all)} 的文件可能已失效或格式异常。重做对应素材后再导出，避免黑屏、静音或导出失败。
                </span>
              </div>
            </div>
            <div className="kv-media-readiness-actions">
              {invalidMedia.visual.length > 0 ? (
                <button disabled={isBusy} onClick={() => onRegenerate(invalidMedia.visual)} type="button">
                  {isBusy ? <Loader2 className="kv-spin" size={15} /> : <ImagePlus size={15} />}
                  重做异常画面：场景 {sceneNumberListLabel(invalidMedia.visual)}
                </button>
              ) : null}
              {invalidMedia.audio.length > 0 ? (
                <button disabled={isBusy} onClick={() => onRegenerateAudio(invalidMedia.audio)} type="button">
                  {isBusy ? <Loader2 className="kv-spin" size={15} /> : <Mic2 size={15} />}
                  重做异常配音：场景 {sceneNumberListLabel(invalidMedia.audio)}
                </button>
              ) : null}
            </div>
          </section>
        ) : null}
        {generationIssueCount > 0 ? (
          <section className="kv-media-readiness kv-media-readiness-retry" role="status" aria-label="生成未完成素材">
            <div>
              <RefreshCcw size={18} />
              <div>
                <strong>刚才有 {generationIssueCount} 个素材没有生成完成</strong>
                <span>可以只重试失败的场景，不需要重新规划脚本和分镜。</span>
              </div>
            </div>
            <div className="kv-media-readiness-actions">
              {generationIssue.visual.length > 0 ? (
                <button disabled={isBusy} onClick={() => onRegenerate(generationIssue.visual)} type="button">
                  {isBusy ? <Loader2 className="kv-spin" size={15} /> : <ImagePlus size={15} />}
                  重试画面：场景 {sceneNumberListLabel(generationIssue.visual)}
                </button>
              ) : null}
              {generationIssue.audio.length > 0 ? (
                <button disabled={isBusy} onClick={() => onRegenerateAudio(generationIssue.audio)} type="button">
                  {isBusy ? <Loader2 className="kv-spin" size={15} /> : <Mic2 size={15} />}
                  重试配音：场景 {sceneNumberListLabel(generationIssue.audio)}
                </button>
              ) : null}
              {generationIssue.clip.length > 0 ? (
                <button disabled={isBusy} onClick={() => onGenerateClips(generationIssue.clip)} type="button">
                  {isBusy ? <Loader2 className="kv-spin" size={15} /> : <FileVideo2 size={15} />}
                  重试动态镜头：场景 {sceneNumberListLabel(generationIssue.clip)}
                </button>
              ) : null}
            </div>
          </section>
        ) : null}
        {versionsOpen ? (
          <section className="kv-version-panel">
            <div className="kv-strip-heading">
              <div>
                <span className="kv-eyebrow">版本历史</span>
                <h3>每次确认修改都会保留一个版本</h3>
              </div>
              <span>{versions.length} 个版本</span>
            </div>
            {versionsLoading ? (
              <div className="kv-version-loading"><Loader2 className="kv-spin" size={18} />正在读取版本...</div>
            ) : (
              <div className="kv-version-list">
                {versions.map((version) => (
                  <article className={version.isCurrent ? "current" : ""} key={version.id}>
                    <div>
                      <strong>{version.label}</strong>
                      {version.isCurrent ? <span>当前</span> : null}
                    </div>
                    <p className="kv-version-change">{version.changeSummary?.description ?? "版本快照"}</p>
                    <p>{version.sceneCount} 个场景 · {durationLabel(version.durationSeconds)}</p>
                    <small className={mediaCompletenessClass(version)}>{mediaCompletenessLabel(version)}</small>
                    <time>{new Date(version.createdAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
                    <button disabled={isBusy || versionPreviewLoading} onClick={() => onPreviewVersion(version.id)} type="button">
                      <Eye size={15} />预览比较
                    </button>
                    {!version.isCurrent ? (
                      <button disabled={isBusy} onClick={() => onRestoreVersion(version.id)} type="button">
                        <RotateCcw size={15} />恢复为新版本
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
            {versionPreviewLoading ? (
              <div className="kv-version-loading"><Loader2 className="kv-spin" size={18} />正在准备版本对比...</div>
            ) : versionPreview ? (
              <div className="kv-version-preview">
                <div className="kv-strip-heading">
                  <div><span className="kv-eyebrow">版本比较</span><h3>确认差异后再决定是否恢复</h3></div>
                  <button aria-label="关闭版本比较" onClick={onCloseVersionPreview} title="关闭" type="button"><X size={17} /></button>
                </div>
                <VersionComparison preview={versionPreview} />
              </div>
            ) : null}
          </section>
        ) : null}
        {exportsOpen ? (
          <section className="kv-export-panel">
            <div className="kv-strip-heading">
              <div>
                <span className="kv-eyebrow">导出记录</span>
                <h3>MP4 合成任务与成片</h3>
              </div>
              <span>{renderJobs.length} 条记录</span>
            </div>
            {exportsLoading ? (
              <div className="kv-version-loading"><Loader2 className="kv-spin" size={18} />正在读取导出记录...</div>
            ) : renderJobs.length === 0 ? (
              <div className="kv-export-empty">
                <FileVideo2 size={20} />
                <span>当前项目还没有导出记录</span>
              </div>
            ) : (
              <div className="kv-export-list">
                {renderJobs.map((job) => {
                  const active = job.status === "queued" || job.status === "running";
                  const qualityLabel = renderJobQualityLabel(job);
                  const metadataItems = renderJobMetadataItems(job);
                  return (
                    <article className={`status-${job.status}`} key={job.id}>
                      <div className="kv-export-summary">
                        <strong>{job.versionLabel ?? `版本 ${job.versionId.slice(0, 8)}`}</strong>
                        <span>{renderJobStatus(job)}</span>
                      </div>
                      <time>{renderJobTime(job)}</time>
                      {qualityLabel ? <p className="kv-export-quality"><Check size={14} />{qualityLabel}</p> : null}
                      {metadataItems.length > 0 ? (
                        <div className="kv-export-metadata" aria-label="成片校验信息">
                          {metadataItems.map((item) => <span key={item}>{item}</span>)}
                        </div>
                      ) : null}
                      {active ? (
                        <div className="kv-export-progress" aria-label={`导出进度 ${job.progress}%`}>
                          <span style={{ width: `${Math.max(4, job.progress)}%` }} />
                        </div>
                      ) : null}
                      {job.error && job.status === "failed" ? <p>{job.error}</p> : null}
                      <div className="kv-export-actions">
                        {job.status === "ready" && job.renderUrl ? (
                          <a download href={job.renderUrl}>
                            <Download size={15} />下载 MP4
                          </a>
                        ) : null}
                        {active ? (
                          <button onClick={() => onCancelExport(job.id)} type="button">
                            <X size={15} />取消导出
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        ) : null}
        {assetsOpen ? (
          <SceneAssetsPanel
            isBusy={isBusy}
            onAdoptCandidate={(assetId) => onMutateScene({ operation: "set-visual", sceneNumber: scene.sceneNumber, assetId })}
            onComparisonOpened={onCandidateComparisonOpened}
            onGenerateCandidate={(instruction) => onGenerateCandidate(scene.sceneNumber, instruction)}
            onRemove={onRemoveAsset}
            onUpload={onUpload}
            openComparisonId={candidateToCompare?.sceneNumber === scene.sceneNumber ? candidateToCompare.assetId : undefined}
            scene={scene}
            uploadProgress={uploadProgress}
          />
        ) : null}
        {productionOpen ? (
          <ProductionSettingsPanel
            durationSeconds={project.currentVersion.durationSeconds}
            isBusy={isBusy}
            logo={productionAsset(project, "logo")}
            music={productionAsset(project, "music")}
            onChange={onUpdateProduction}
            onRemove={onRemoveProduction}
            onUpload={onUploadProduction}
            settings={filmSettings}
            uploadProgress={uploadProgress}
            uploadType={productionUploadType}
          />
        ) : null}
        {view === "preview" ? (
          <>
            {missingSceneNumbers.length === 0 ? (
              <KnowVideoPlayer className="kv-remotion-player" project={project} ref={playerRef} />
            ) : (
              <section className="kv-preview missing-image">
                <div className="kv-missing-visual">
                  <ImagePlus size={34} />
                  <strong>还有 {missingSceneNumbers.length} 个场景没有画面</strong>
                  <p>生成缺失素材后，时间轴预览和 MP4 导出才会启用。</p>
                  <button disabled={isBusy} onClick={() => onRegenerate(missingSceneNumbers)} type="button">
                    {isBusy ? <Loader2 className="kv-spin" size={16} /> : <RefreshCcw size={16} />}
                    生成缺失画面
                  </button>
                </div>
              </section>
            )}
            <Storyboard
              isBusy={isBusy || exportProgress !== undefined}
              onGenerateClip={onGenerateClip}
              onMutate={onMutateScene}
              onRegenerate={onRegenerate}
              onRegenerateAudio={onRegenerateAudio}
              onSelect={selectScene}
              scenes={project.currentVersion.scenes}
              selectedScene={selectedScene}
            />
            <ScenePanel
              isBusy={isBusy}
              onSave={onSaveScene}
              onVoiceChange={onVoiceChange}
              scene={scene}
            />
          </>
        ) : (
          <StoryboardBoard scenes={project.currentVersion.scenes} />
        )}
      </section>
      <ChatPanel
        busyAction={busyAction}
        input={input}
        isBusy={isBusy}
        messages={messages}
        onApply={onApply}
        onCancel={onCancel}
        onInput={onInput}
        onPreview={onPreviewPlan}
        onSubmit={onSubmit}
        pendingPlan={pendingPlan}
        scenes={project.currentVersion.scenes}
      />
    </div>
  );
}

export function WorkspaceClient({
  initialProject,
  initialMessages,
  initialPendingPlan,
  source
}: {
  initialProject: Project;
  initialMessages: ChatMessage[];
  initialPendingPlan?: EditPlan;
  source: Source;
}) {
  const [project, setProject] = useState(initialProject);
  const [projectSource, setProjectSource] = useState<Source>(source);
  const [stage, setStage] = useState<Stage>(initialPendingPlan ? "studio" : "brief");
  const [briefPrompt, setBriefPrompt] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [selectedScene, setSelectedScene] = useState(1);
  const [pendingPlan, setPendingPlan] = useState<EditPlan | undefined>(initialPendingPlan);
  const [isBusy, setIsBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction>();
  const [progress, setProgress] = useState(0);
  const [generationStatus, setGenerationStatus] = useState("正在理解视频需求");
  const [generationStartedAt, setGenerationStartedAt] = useState<number>();
  const [studioView, setStudioView] = useState<StudioView>("preview");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [exportProgress, setExportProgress] = useState<number | undefined>();
  const [invalidRenderMedia, setInvalidRenderMedia] = useState<InvalidRenderMedia[]>([]);
  const [generationIssues, setGenerationIssues] = useState<GenerationMediaIssue[]>([]);
  const [versions, setVersions] = useState<ProjectVersionSummary[]>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionPreview, setVersionPreview] = useState<ProjectVersionPreview>();
  const [versionPreviewLoading, setVersionPreviewLoading] = useState(false);
  const [renderJobs, setRenderJobs] = useState<RenderJob[]>([]);
  const [exportsOpen, setExportsOpen] = useState(false);
  const [exportsLoading, setExportsLoading] = useState(false);
  const [activeRenderJobId, setActiveRenderJobId] = useState<string | undefined>(initialProject.currentVersion.renderJobId);
  const [uploadProgress, setUploadProgress] = useState<number | undefined>();
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [candidateToCompare, setCandidateToCompare] = useState<{ sceneNumber: number; assetId: string }>();
  const [productionOpen, setProductionOpen] = useState(false);
  const [productionUploadType, setProductionUploadType] = useState<"logo" | "music">();
  const [generationOptions, setGenerationOptions] = useState<GenerationOptions>({
    duration: "30",
    sceneCount: "auto",
    language: "中文",
    style: "电影质感",
    motion: "key-scenes"
  });
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [projectQuery, setProjectQuery] = useState("");
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectActionBusy, setProjectActionBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const recoveringRenderRef = useRef<string>();
  const recoveringGenerationRef = useRef(false);
  const cancelledRenderIdsRef = useRef(new Set<string>());

  const generationPrompt = useMemo(() => briefPrompt.trim(), [briefPrompt]);

  useEffect(() => {
    setCandidateToCompare(undefined);
  }, [project.id, project.currentVersion.id]);

  useEffect(() => {
    const jobId = project.currentVersion.renderJobId;
    if (!jobId || project.currentVersion.renderUrl || recoveringRenderRef.current === jobId) return;
    recoveringRenderRef.current = jobId;
    setActiveRenderJobId(jobId);
    let cancelled = false;
    setExportProgress((current) => current ?? 5);
    void waitForRenderJob(
      jobId,
      () => cancelled || cancelledRenderIdsRef.current.has(jobId),
      (progress) => {
        setExportProgress(progress);
        setRenderJobs((current) => current.map((job) => job.id === jobId ? { ...job, progress } : job));
      }
    )
      .then((completed) => {
        if (!completed || cancelled) return;
        setRenderJobs((current) => [completed, ...current.filter((job) => job.id !== completed.id)]);
        if (completed.status !== "ready" || !completed.renderUrl) {
          throw new Error(completed.error || "MP4 渲染失败。");
        }
        setExportProgress(100);
        setProject((current) => current.currentVersion.id === completed.versionId
          ? {
            ...current,
            currentVersion: {
              ...current.currentVersion,
              renderJobId: undefined,
              renderUrl: completed.renderUrl,
              status: "ready"
            }
          }
          : current);
        pushMessage({
          role: "assistant",
          type: "text",
          content: "后台导出已经完成，可以下载 1080p MP4。",
          versionId: completed.versionId
        }, true);
      })
      .catch((error) => {
        if (cancelled || cancelledRenderIdsRef.current.has(jobId)) return;
        const message = error instanceof Error ? error.message : "视频导出失败。";
        setErrorMessage(message);
        pushMessage({ role: "assistant", type: "text", content: message });
      })
      .finally(() => {
        if (recoveringRenderRef.current === jobId) recoveringRenderRef.current = undefined;
        setActiveRenderJobId((current) => current === jobId ? undefined : current);
        if (!cancelled) setExportProgress(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [project.currentVersion.id, project.currentVersion.renderJobId, project.currentVersion.renderUrl]);

  useEffect(() => {
    if (recoveringGenerationRef.current) return;
    const pending = readPendingGenerationSession();
    if (!pending) {
      clearPendingGenerationSession();
      return;
    }
    recoveringGenerationRef.current = true;
    setBriefPrompt(pending.prompt);
    setGenerationOptions(pending.options);
    setGenerationStartedAt(pending.startedAt);
    setIsBusy(true);
    setErrorMessage(undefined);
    setProgress(36);
    setGenerationStatus("正在恢复刷新前的视频生成任务");
    setStage("generating");
    void waitForGenerationRequest(pending.requestId, () => {
      setGenerationStatus("正在等待后台完成脚本与分镜");
    })
      .then((data) => continueGeneratedProject(data, pending.options, true))
      .catch((error) => {
        const message = requestErrorMessage(error, "生成任务恢复失败，请稍后重试。");
        setErrorMessage(message);
        setStage("brief");
        if (/没有完成|没有找到|标识无效|数据不完整/.test(message)) {
          clearPendingGenerationSession();
        }
      })
      .finally(() => {
        recoveringGenerationRef.current = false;
        setIsBusy(false);
      });
  }, []);

  function pushMessage(message: Omit<ChatMessage, "id">, persist = false) {
    const id = crypto.randomUUID();
    setMessages((current) => {
      const last = current[current.length - 1];
      if (last?.role === message.role && last.content === message.content) return current;
      return [...current, { ...message, id }];
    });
    if (!persist || message.role !== "assistant") return;
    void fetch("/api/chat-messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id,
        projectId: project.id,
        versionId: message.versionId ?? project.currentVersion.id,
        content: message.content
      }),
      keepalive: true
    }).catch((error) => {
      console.error("[chat-message] Unable to persist production event:", error);
    });
  }

  async function continueGeneratedProject(
    data: Required<Pick<StoryboardGenerationResponse, "project" | "messages" | "engine">> & StoryboardGenerationResponse,
    options: GenerationOptions,
    resumeMissingOnly = false
  ) {
    let generatedProject = data.project;
    const warnings: string[] = [];
    const issues: GenerationMediaIssue[] = [];
    setProject(generatedProject);
    setProjectSource("database");
    setProjects([]);
    setVersions([]);
    setRenderJobs([]);
    setInvalidRenderMedia([]);
    setGenerationIssues([]);
    setVersionsOpen(false);
    setExportsOpen(false);
    setAssetsOpen(false);
    setProductionOpen(false);
    setActiveRenderJobId(undefined);
    setMessages([
      ...data.messages,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        type: "text",
        content: data.engine === "ai"
          ? "AI 已完成脚本、分镜和镜头提示词。你可以继续用右侧对话改片。"
          : "已用本地规则生成初版分镜。"
      }
    ]);

    const missingImageSceneNumbers = missingSceneAssetNumbers(generatedProject.currentVersion.scenes, "image");
    if (!resumeMissingOnly || missingImageSceneNumbers.length > 0) {
      setProgress(64);
      setGenerationStatus(resumeMissingOnly ? "正在补齐尚未完成的场景画面" : "正在生成统一风格的场景画面");
      try {
        const imageResponse = await fetch("/api/assets/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: generatedProject.id,
            versionId: generatedProject.currentVersion.id,
            sceneNumbers: resumeMissingOnly ? missingImageSceneNumbers : undefined,
            quality: "standard"
          }),
          signal: AbortSignal.timeout(125_000)
        });
        const imageData = await imageResponse.json() as MediaGenerationResponse;
        if (imageData.project) {
          generatedProject = imageData.project;
          setProject(generatedProject);
        }
        if (!imageResponse.ok || (imageData.failedSceneNumbers?.length ?? 0) > 0) {
          warnings.push(imageData.error || "部分场景画面生成失败。");
          const failed = imageData.failedSceneNumbers?.length ? imageData.failedSceneNumbers : missingImageSceneNumbers;
          issues.push(...failed.map((sceneNumber) => ({ sceneNumber, type: "visual" as const, reason: imageData.error || "场景画面生成失败" })));
        }
      } catch (error) {
        const reason = requestErrorMessage(error, "场景画面生成失败。");
        warnings.push(reason);
        issues.push(...missingImageSceneNumbers.map((sceneNumber) => ({ sceneNumber, type: "visual" as const, reason })));
      }
    }

    const missingAudioSceneNumbers = missingSceneAssetNumbers(generatedProject.currentVersion.scenes, "audio");
    if (!resumeMissingOnly || missingAudioSceneNumbers.length > 0) {
      setProgress(84);
      setGenerationStatus(resumeMissingOnly ? "正在补齐尚未完成的自然配音" : "正在生成自然配音");
      try {
        const audioResponse = await fetch("/api/assets/audio/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: generatedProject.id,
            versionId: generatedProject.currentVersion.id,
            sceneNumbers: resumeMissingOnly ? missingAudioSceneNumbers : undefined
          }),
          signal: AbortSignal.timeout(125_000)
        });
        const audioData = await audioResponse.json() as MediaGenerationResponse;
        if (audioData.project) {
          generatedProject = audioData.project;
          setProject(generatedProject);
        }
        if (!audioResponse.ok || (audioData.failedSceneNumbers?.length ?? 0) > 0) {
          warnings.push(audioData.error || "部分场景配音生成失败。");
          const failed = audioData.failedSceneNumbers?.length ? audioData.failedSceneNumbers : missingAudioSceneNumbers;
          issues.push(...failed.map((sceneNumber) => ({ sceneNumber, type: "audio" as const, reason: audioData.error || "场景配音生成失败" })));
        }
      } catch (error) {
        const reason = requestErrorMessage(error, "场景配音生成失败。");
        warnings.push(reason);
        issues.push(...missingAudioSceneNumbers.map((sceneNumber) => ({ sceneNumber, type: "audio" as const, reason })));
      }
    }

    if (options.motion === "key-scenes") {
      const selectedDynamicScenes = selectMotionCriticalScenes(
        generatedProject.currentVersion.scenes,
        generatedProject.currentVersion.durationSeconds
      );
      const dynamicScenes = resumeMissingOnly
        ? missingMotionSceneNumbers(generatedProject.currentVersion.scenes, selectedDynamicScenes)
        : selectedDynamicScenes;
      if (dynamicScenes.length === 0 && generatedProject.currentVersion.scenes.every((scene) => !sceneVisualAsset(scene))) {
        warnings.push("没有可用于生成动态镜头的场景画面，请先在工作室补齐画面。");
      } else {
        for (const [index, sceneNumber] of dynamicScenes.entries()) {
          setProgress(88 + Math.round((index / Math.max(1, dynamicScenes.length)) * 6));
          setGenerationStatus(`正在生成场景 ${sceneNumber} 的动态视频镜头`);
          try {
            generatedProject = await requestVideoClips(generatedProject, [sceneNumber], "standard");
            setProject(generatedProject);
          } catch (error) {
            const reason = requestErrorMessage(error, `场景 ${sceneNumber} 的动态镜头生成失败。`);
            warnings.push(reason);
            issues.push({ sceneNumber, type: "clip", reason });
          }
        }
      }
    }

    setGenerationStatus("正在保存可继续编辑的项目");
    setProgress(96);
    setGenerationIssues(issues);
    if (warnings.length > 0) setErrorMessage(Array.from(new Set(warnings)).join(" "));
    setMessages((current) => [...current, {
      id: crypto.randomUUID(),
      role: "assistant",
      type: "text",
      content: warnings.length > 0
        ? "脚本和分镜已经保存，部分媒体素材需要在工作室中重试。"
        : resumeMissingOnly
          ? "生成任务已经恢复，缺失的场景素材已继续完成。"
          : options.motion === "key-scenes"
            ? "场景画面、自然配音和关键动态镜头已经完成，可以播放预览或继续通过对话修改。"
            : "全部场景画面和配音已经完成，可以播放预览或继续通过对话修改。"
    }]);
    setSelectedScene(1);
    setPendingPlan(undefined);
    setStudioView("preview");
    setProgress(100);
    setGenerationStartedAt(undefined);
    clearPendingGenerationSession();
    window.setTimeout(() => setStage("studio"), 350);
  }

  async function createVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = generationPrompt;
    if (!prompt) return;
    const startedAt = Date.now();

    setIsBusy(true);
    setErrorMessage(undefined);
    setGenerationStartedAt(startedAt);
    setProgress(8);
    setGenerationStatus("正在理解视频需求");
    setStage("generating");

    try {
      setProgress(18);
      setGenerationStatus("正在规划脚本与分镜");
      const requestId = crypto.randomUUID();
      const pendingSession: PendingGenerationSession = {
        requestId,
        prompt,
        options: generationOptions,
        startedAt
      };
      savePendingGenerationSession(pendingSession);
      let data: Required<Pick<StoryboardGenerationResponse, "project" | "messages" | "engine">> & StoryboardGenerationResponse;
      try {
        const response = await fetch("/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt, options: generationOptions, requestId }),
          signal: AbortSignal.timeout(90_000)
        });
        const result = await response.json().catch(() => ({})) as StoryboardGenerationResponse;
        if (response.status === 202 || result.status === "pending") {
          data = await waitForGenerationRequest(requestId, () => {
            setProgress(36);
            setGenerationStatus("脚本与分镜仍在后台生成，正在自动恢复");
          });
        } else {
          if (!response.ok) throw new Error(result.error || "视频项目创建失败。");
          if (!result.project || !Array.isArray(result.messages) || !result.engine) {
            throw new Error("视频项目创建返回的数据不完整，请重试。");
          }
          data = { ...result, project: result.project, messages: result.messages, engine: result.engine };
        }
      } catch (error) {
        const connectionInterrupted = error instanceof TypeError
          || (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name));
        if (!connectionInterrupted) throw error;
        data = await waitForGenerationRequest(requestId, () => {
          setProgress(36);
          setGenerationStatus("连接超时，正在找回后台生成结果");
        });
      }
      await continueGeneratedProject(data, generationOptions, data.recovered === true);
    } catch (error) {
      console.error(error);
      setStage("brief");
      setGenerationStartedAt(undefined);
      setErrorMessage(requestErrorMessage(error, "生成失败，请稍后重试。"));
      pushMessage({
        role: "assistant",
        type: "text",
        content: "这次生成没有完成。你的需求仍保留在输入框中，可以稍后重试；如果持续失败，请从项目列表重新打开后再生成。"
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function submitChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = chatInput.trim();
    if (!request) return;

    setChatInput("");
    setCandidateToCompare(undefined);
    setIsBusy(true);
    const candidateIntent = pendingPlan
      ? undefined
      : candidateEditFromRequest(
          request,
          project.currentVersion.scenes.map((scene) => scene.sceneNumber)
        );
    setBusyAction(pendingPlan ? "refining-edit" : candidateIntent ? "generating-candidate" : "planning-edit");
    setErrorMessage(undefined);
    pushMessage({ role: "user", type: "text", content: request });

    try {
      const response = await fetch("/api/edit-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          versionId: project.currentVersion.id,
          editPlanId: pendingPlan?.id,
          request
        }),
        signal: AbortSignal.timeout(candidateIntent ? 125_000 : 45_000)
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(failure.error || "修改计划生成失败，请重试。");
      }
      const data = await response.json() as {
        action?: "visual-candidate";
        editPlan?: EditPlan;
        messages: ChatMessage[];
        project?: Project;
        candidate?: SceneAsset;
        candidateIntent?: { sceneNumber: number; instruction: string };
      };
      if (data.action === "visual-candidate") {
        if (!data.project || !data.candidate || !data.candidateIntent || !Array.isArray(data.messages)) {
          throw new Error("候选画面返回格式异常，请重试。");
        }
        const assistantMessages = data.messages.filter((message) => message.role === "assistant");
        setProject(data.project);
        setPendingPlan(undefined);
        setSelectedScene(data.candidateIntent.sceneNumber);
        setStudioView("preview");
        setVersionsOpen(false);
        setExportsOpen(false);
        setProductionOpen(false);
        setAssetsOpen(true);
        setCandidateToCompare({ sceneNumber: data.candidateIntent.sceneNumber, assetId: data.candidate.id });
        setMessages((current) => [...current, ...assistantMessages]);
        return;
      }
      if (!data.editPlan || !Array.isArray(data.messages)) {
        throw new Error("修改计划返回格式异常，请重试。");
      }
      const assistantMessages = data.messages.filter((message) => message.role === "assistant");
      setPendingPlan(data.editPlan);
      setMessages((current) => [...current, ...assistantMessages]);
    } catch (error) {
      console.error(error);
      pushMessage({
        role: "assistant",
        type: "text",
        content: error instanceof Error ? error.message : "没有生成修改计划，请稍后重试。"
      });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function applyEditPlanRequest(editPlan: EditPlan, direct = false) {
    const response = await fetch("/api/edit-plan/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        versionId: project.currentVersion.id,
        direct,
        editPlan
      }),
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(failure.error || "应用修改失败。");
    }
    const data = await response.json() as {
      project: Project;
      message: ChatMessage;
      selectedSceneNumber?: number;
      regeneration: { imageSceneNumbers: number[]; audioSceneNumbers: number[]; clipSceneNumbers: number[] };
    };
    let updatedProject = data.project;
    const warnings: string[] = [];
    setProject(updatedProject);
    setMessages((current) => [...current, data.message]);
    if (data.selectedSceneNumber) setSelectedScene(data.selectedSceneNumber);
    setVersions([]);

    if (data.regeneration.imageSceneNumbers.length > 0) {
      setBusyAction("generating-images");
      try {
        const imageResponse = await fetch("/api/assets/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: updatedProject.id,
            versionId: updatedProject.currentVersion.id,
            sceneNumbers: data.regeneration.imageSceneNumbers,
            quality: "standard"
          }),
          signal: AbortSignal.timeout(125_000)
        });
        const imageData = await imageResponse.json() as { project?: Project; error?: string };
        if (imageData.project) {
          updatedProject = imageData.project;
          setProject(updatedProject);
        }
        if (!imageResponse.ok) warnings.push(imageData.error || "部分修改场景的画面生成失败。");
      } catch (error) {
        warnings.push(requestErrorMessage(error, "修改场景的画面生成失败。"));
      }
    }

    if (data.regeneration.audioSceneNumbers.length > 0) {
      setBusyAction("generating-audio");
      try {
        const audioResponse = await fetch("/api/assets/audio/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: updatedProject.id,
            versionId: updatedProject.currentVersion.id,
            sceneNumbers: data.regeneration.audioSceneNumbers
          }),
          signal: AbortSignal.timeout(125_000)
        });
        const audioData = await audioResponse.json() as { project?: Project; error?: string };
        if (audioData.project) {
          updatedProject = audioData.project;
          setProject(updatedProject);
        }
        if (!audioResponse.ok) warnings.push(audioData.error || "部分修改场景的配音生成失败。");
      } catch (error) {
        warnings.push(requestErrorMessage(error, "修改场景的配音生成失败。"));
      }
    }

    if (data.regeneration.clipSceneNumbers.length > 0) {
      setBusyAction("generating-video");
      try {
        updatedProject = await requestVideoClips(updatedProject, data.regeneration.clipSceneNumbers, "standard");
        setProject(updatedProject);
      } catch (error) {
        warnings.push(requestErrorMessage(error, "修改场景的动态镜头生成失败。"));
      }
    }

    const completionMessage = warnings.length > 0
      ? `文字修改和新版本已经保存。${Array.from(new Set(warnings)).join(" ")}`
      : data.regeneration.imageSceneNumbers.length > 0
        || data.regeneration.audioSceneNumbers.length > 0
        || data.regeneration.clipSceneNumbers.length > 0
        ? "修改内容和受影响素材已经全部更新。"
        : "修改内容已经保存。";
    pushMessage({
      role: "assistant",
      type: "text",
      content: completionMessage,
      versionId: updatedProject.currentVersion.id
    }, true);
    if (warnings.length > 0) setErrorMessage(Array.from(new Set(warnings)).join(" "));
    setBusyAction("applying-edit");
    return updatedProject;
  }

  async function previewPendingPlan() {
    if (!pendingPlan) return;
    setIsBusy(true);
    setBusyAction("previewing-plan");
    setErrorMessage(undefined);
    try {
      const response = await fetch("/api/edit-plan/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          versionId: project.currentVersion.id,
          editPlanId: pendingPlan.id
        }),
        signal: AbortSignal.timeout(125_000)
      });
      const data = await response.json() as { project?: Project; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error || "真实画面预览生成失败。");
      setProject(data.project);
      const firstScene = editPlanVisualSceneNumbers(pendingPlan)[0];
      if (firstScene) setSelectedScene(firstScene);
    } catch (error) {
      const message = requestErrorMessage(error, "真实画面预览生成失败，请稍后重试。");
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function applyPlan() {
    if (!pendingPlan) return;

    setIsBusy(true);
    setBusyAction("applying-edit");
    setErrorMessage(undefined);
    try {
      await applyEditPlanRequest(pendingPlan);
      setPendingPlan(undefined);
    } catch (error) {
      console.error(error);
      pushMessage({
        role: "assistant",
        type: "text",
        content: error instanceof Error ? error.message : "应用修改失败，请重试。"
      });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function mutateSceneStructure(mutation: SceneStructureMutation) {
    setIsBusy(true);
    setBusyAction("editing-timeline");
    setErrorMessage(undefined);
    try {
      const response = await fetch("/api/scenes/mutate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          versionId: project.currentVersion.id,
          ...mutation
        })
      });
      const data = await response.json() as {
        project?: Project;
        message?: ChatMessage;
        selectedSceneNumber?: number;
        regeneration?: { imageSceneNumbers: number[]; audioSceneNumbers: number[]; clipSceneNumbers: number[] };
        error?: string;
      };
      if (!response.ok || !data.project || !data.message || !data.selectedSceneNumber) {
        throw new Error(data.error || "时间线调整失败。");
      }
      let updatedProject = data.project;
      const warnings: string[] = [];
      setProject(updatedProject);
      setMessages((current) => [...current, data.message!]);
      setSelectedScene(data.selectedSceneNumber);
      setPendingPlan(undefined);
      setVersions([]);
      setVersionsOpen(false);
      setExportsOpen(false);
      setAssetsOpen(mutation.operation === "set-visual");
      setProductionOpen(false);
      setActiveRenderJobId(undefined);

      const regeneration = data.regeneration ?? { imageSceneNumbers: [], audioSceneNumbers: [], clipSceneNumbers: [] };
      if (regeneration.imageSceneNumbers.length > 0) {
        setBusyAction("generating-images");
        try {
          const imageResponse = await fetch("/api/assets/generate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              projectId: updatedProject.id,
              versionId: updatedProject.currentVersion.id,
              sceneNumbers: regeneration.imageSceneNumbers,
              quality: "standard"
            }),
            signal: AbortSignal.timeout(125_000)
          });
          const imageData = await imageResponse.json() as { project?: Project; error?: string };
          if (imageData.project) {
            updatedProject = imageData.project;
            setProject(updatedProject);
          }
          if (!imageResponse.ok) warnings.push(imageData.error || "拆分或合并后的画面生成失败。");
        } catch (error) {
          warnings.push(requestErrorMessage(error, "拆分或合并后的画面生成失败。"));
        }
      }
      if (regeneration.audioSceneNumbers.length > 0) {
        setBusyAction("generating-audio");
        try {
          const audioResponse = await fetch("/api/assets/audio/generate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              projectId: updatedProject.id,
              versionId: updatedProject.currentVersion.id,
              sceneNumbers: regeneration.audioSceneNumbers
            }),
            signal: AbortSignal.timeout(125_000)
          });
          const audioData = await audioResponse.json() as { project?: Project; error?: string };
          if (audioData.project) {
            updatedProject = audioData.project;
            setProject(updatedProject);
          }
          if (!audioResponse.ok) warnings.push(audioData.error || "拆分或合并后的配音生成失败。");
        } catch (error) {
          warnings.push(requestErrorMessage(error, "拆分或合并后的配音生成失败。"));
        }
      }
      if (regeneration.imageSceneNumbers.length > 0 || regeneration.audioSceneNumbers.length > 0) {
        const uniqueWarnings = Array.from(new Set(warnings));
        pushMessage({
          role: "assistant",
          type: "text",
          content: uniqueWarnings.length > 0
            ? `分镜结构和新版本已经保存。${uniqueWarnings.join(" ")}`
            : "分镜结构、场景画面和配音已经全部更新。",
          versionId: updatedProject.currentVersion.id
        }, true);
        if (uniqueWarnings.length > 0) setErrorMessage(uniqueWarnings.join(" "));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "时间线调整失败。";
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function saveSceneEdits(sceneNumber: number, edits: SceneTextEdits) {
    const scene = project.currentVersion.scenes.find((item) => item.sceneNumber === sceneNumber);
    if (!scene) return;
    const voiceoverChanged = edits.voiceover !== scene.voiceover;
    const titleChanged = edits.title !== scene.title;
    const visualChanged = edits.visualPrompt !== scene.visualPrompt;
    const motionChanged = edits.motionPrompt !== scene.motionPrompt;
    if (!titleChanged && !voiceoverChanged && !visualChanged && !motionChanged) return;

    const regenerate = new Set<SceneAsset["type"]>();
    if (voiceoverChanged) {
      regenerate.add("audio");
      regenerate.add("caption");
    }
    if (visualChanged) {
      regenerate.add("image");
      regenerate.add("thumbnail");
    }
    if (titleChanged) regenerate.add("caption");
    if (motionChanged || regenerate.size > 0) regenerate.add("render");
    const plan: EditPlan = {
      id: crypto.randomUUID(),
      editNumber: Math.max(1, Math.round(Date.now() / 1000) % 10000),
      baseVersionId: project.currentVersion.id,
      status: "proposed",
      userRequest: `直接编辑场景 ${sceneNumber}`,
      summary: `更新场景 ${sceneNumber} 的制作内容，并创建一个可恢复的新版本。`,
      affectedScenes: [sceneNumber],
      changes: [{
        sceneNumber,
        status: "updated",
        before: {
          title: scene.title,
          voiceover: scene.voiceover,
          thumbnailTone: scene.style.theme.includes("light") ? "light" : "dark",
          visualPrompt: scene.visualPrompt,
          motionPrompt: scene.motionPrompt
        },
        after: {
          ...edits,
          thumbnailTone: scene.style.theme.includes("light") ? "light" : "dark"
        },
        regenerate: Array.from(regenerate)
      }],
      createdAt: new Date().toISOString()
    };

    setIsBusy(true);
    setBusyAction("saving-scene");
    setErrorMessage(undefined);
    try {
      await applyEditPlanRequest(plan, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "场景保存失败。";
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function cancelPlan() {
    const plan = pendingPlan;
    if (!plan) return;
    setPendingPlan(undefined);
    try {
      const response = await fetch("/api/edit-plan/reject", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          versionId: project.currentVersion.id,
          editPlanId: plan.id
        })
      });
      const data = await response.json() as { message?: ChatMessage; error?: string };
      if (!response.ok || !data.message) throw new Error(data.error || "取消修改方案失败。");
      setProject((current) => removeEditPlanPreviewAssets(current, plan.id));
      setMessages((current) => [...current, data.message!]);
    } catch (error) {
      console.error(error);
      setPendingPlan(plan);
      const message = error instanceof Error ? error.message : "取消修改方案失败。";
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    }
  }

  async function loadVersions() {
    setVersionsLoading(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/versions`, { cache: "no-store" });
      const data = await response.json() as { versions?: ProjectVersionSummary[]; error?: string };
      if (!response.ok) throw new Error(data.error || "版本历史读取失败。");
      setVersions(data.versions ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "版本历史读取失败。";
      setErrorMessage(message);
    } finally {
      setVersionsLoading(false);
    }
  }

  async function previewVersion(versionId: string) {
    setVersionPreviewLoading(true);
    setErrorMessage(undefined);
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/versions/${encodeURIComponent(versionId)}`,
        { cache: "no-store" }
      );
      const data = await response.json() as ProjectVersionPreview & { error?: string };
      if (!response.ok || !data.version || !data.currentVersion) {
        throw new Error(data.error || "版本预览读取失败。");
      }
      setVersionPreview(data);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "版本预览读取失败。");
      setVersionPreview(undefined);
    } finally {
      setVersionPreviewLoading(false);
    }
  }

  function toggleVersions() {
    const next = !versionsOpen;
    setVersionsOpen(next);
    if (next) {
      setAssetsOpen(false);
      setExportsOpen(false);
      setProductionOpen(false);
    }
    if (!next) setVersionPreview(undefined);
    if (next) void loadVersions();
  }

  async function loadRenderJobs(silent = false) {
    if (projectSource !== "database") {
      setRenderJobs([]);
      setExportsLoading(false);
      return;
    }
    if (!silent) setExportsLoading(true);
    try {
      const response = await fetch(`/api/render-jobs?projectId=${encodeURIComponent(project.id)}`, { cache: "no-store" });
      const data = await response.json() as { renderJobs?: RenderJob[]; error?: string };
      if (!response.ok) throw new Error(data.error || "导出记录读取失败。");
      setRenderJobs(data.renderJobs ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "导出记录读取失败。";
      setErrorMessage(message);
    } finally {
      if (!silent) setExportsLoading(false);
    }
  }

  function toggleExports() {
    const next = !exportsOpen;
    setExportsOpen(next);
    if (next) {
      setAssetsOpen(false);
      setVersionsOpen(false);
      setVersionPreview(undefined);
      setProductionOpen(false);
      void loadRenderJobs();
    }
  }

  useEffect(() => {
    if (!exportsOpen || !renderJobs.some((job) => job.status === "queued" || job.status === "running")) return;
    const interval = window.setInterval(() => void loadRenderJobs(true), 3000);
    return () => window.clearInterval(interval);
  }, [exportsOpen, project.id, renderJobs.some((job) => job.status === "queued" || job.status === "running")]);

  function toggleAssets() {
    setAssetsOpen((current) => !current);
    setVersionsOpen(false);
    setVersionPreview(undefined);
    setExportsOpen(false);
    setProductionOpen(false);
  }

  function toggleProduction() {
    setProductionOpen((current) => !current);
    setAssetsOpen(false);
    setVersionsOpen(false);
    setVersionPreview(undefined);
    setExportsOpen(false);
  }

  async function cancelExport(jobId: string) {
    setErrorMessage(undefined);
    try {
      const response = await fetch("/api/render-jobs", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, jobId })
      });
      const data = await response.json() as { renderJob?: RenderJob; error?: string };
      if (!response.ok || !data.renderJob) throw new Error(data.error || "取消导出失败。");
      cancelledRenderIdsRef.current.add(jobId);
      setRenderJobs((current) => [data.renderJob!, ...current.filter((job) => job.id !== jobId)]);
      setActiveRenderJobId((current) => current === jobId ? undefined : current);
      setExportProgress(undefined);
      if (data.renderJob.versionId === project.currentVersion.id) {
        setProject((current) => ({
          ...current,
          currentVersion: {
            ...current.currentVersion,
            renderJobId: undefined,
            status: "draft",
            renderUrl: undefined
          }
        }));
      }
      pushMessage({
        role: "assistant",
        type: "text",
        content: "本次 MP4 导出已取消，场景和素材不会受到影响。",
        versionId: data.renderJob.versionId
      }, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "取消导出失败。";
      setErrorMessage(message);
    }
  }

  async function restoreVersion(versionId: string) {
    setIsBusy(true);
    setBusyAction("restoring-version");
    setErrorMessage(undefined);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/versions/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId })
      });
      const data = await response.json() as { project?: Project; message?: ChatMessage; error?: string };
      if (!response.ok || !data.project || !data.message) throw new Error(data.error || "版本恢复失败。");
      setProject(data.project);
      setMessages((current) => [...current, data.message!]);
      setSelectedScene(1);
      setPendingPlan(undefined);
      setVersionPreview(undefined);
      await loadVersions();
    } catch (error) {
      const message = error instanceof Error ? error.message : "版本恢复失败。";
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function uploadAsset(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsBusy(true);
    setBusyAction("uploading-asset");
    setUploadProgress(0);
    try {
      const uploadLimit = file.type.startsWith("image/")
        ? 25_000_000
        : file.type.startsWith("audio/")
          ? 80_000_000
          : 500_000_000;
      if (file.size > uploadLimit) {
        const limitLabel = file.type.startsWith("image/")
          ? "25MB"
          : file.type.startsWith("audio/")
            ? "80MB"
            : "500MB";
        throw new Error(`该类型的单个素材不能超过 ${limitLabel}。`);
      }
      let uploadedAsset: SceneAsset;
      if (file.size <= 4_000_000) {
        const form = new FormData();
        form.set("file", file);
        form.set("projectId", project.id);
        form.set("versionId", project.currentVersion.id);
        form.set("sceneNumber", String(selectedScene));
        const response = await fetch("/api/assets/upload", { method: "POST", body: form });
        const data = await response.json() as { asset?: SceneAsset; error?: string };
        if (!response.ok || !data.asset) throw new Error(data.error || "素材上传失败。");
        uploadedAsset = data.asset;
        setUploadProgress(100);
      } else {
        uploadedAsset = await uploadDirectAsset(file);
      }
      setProject((current) => ({
        ...current,
        currentVersion: {
          ...current.currentVersion,
          renderUrl: undefined,
          scenes: current.currentVersion.scenes.map((scene) => scene.sceneNumber === selectedScene
            ? {
                ...scene,
                assets: [
                  uploadedAsset,
                  ...scene.assets.filter((asset) => !replacementAssetTypes(uploadedAsset.type).includes(asset.type))
                ]
              }
            : scene)
        }
      }));
      pushMessage({
        role: "assistant",
        type: "text",
        content: `素材“${String(uploadedAsset.metadata?.name ?? "未命名素材")}”已应用到场景 ${selectedScene}。`,
        versionId: project.currentVersion.id
      }, true);
    } catch (error) {
      console.error(error);
      pushMessage({
        role: "assistant",
        type: "text",
        content: error instanceof Error ? error.message : "素材上传失败，请检查存储配置。"
      });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
      setUploadProgress(undefined);
    }
  }

  async function uploadDirectAsset(file: File): Promise<SceneAsset> {
    const descriptor = {
      projectId: project.id,
      versionId: project.currentVersion.id,
      sceneNumber: selectedScene,
      name: file.name,
      size: file.size,
      contentType: file.type
    };
    const initResponse = await fetch("/api/assets/upload-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(descriptor)
    });
    const session = await initResponse.json() as {
      key?: string;
      uploadUrl?: string;
      error?: string;
    };
    if (!initResponse.ok || !session.key || !session.uploadUrl) {
      throw new Error(session.error || "无法开始大文件上传。");
    }
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", session.uploadUrl!);
      xhr.setRequestHeader("content-type", file.type);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) setUploadProgress(Math.min(96, Math.round((event.loaded / event.total) * 96)));
      };
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`云端存储拒绝了上传（${xhr.status}）。`));
      xhr.onerror = () => reject(new Error("大文件直传失败，请检查 R2 Bucket 的 CORS 设置。"));
      xhr.send(file);
    });
    const attachResponse = await fetch("/api/assets/attach", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...descriptor, key: session.key })
    });
    const attached = await attachResponse.json() as { asset?: SceneAsset; error?: string };
    if (!attachResponse.ok || !attached.asset) throw new Error(attached.error || "无法绑定场景素材。");
    setUploadProgress(100);
    return attached.asset;
  }

  async function updateProductionSettingsAction(settings: Partial<ProductionSettings>) {
    setIsBusy(true);
    setBusyAction("saving-production");
    setErrorMessage(undefined);
    try {
      const response = await fetch("/api/production-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          versionId: project.currentVersion.id,
          settings
        })
      });
      const data = await response.json() as { project?: Project; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error || "成片设置保存失败。");
      setProject(data.project);
    } catch (error) {
      const message = error instanceof Error ? error.message : "成片设置保存失败。";
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function uploadProductionAsset(type: "logo" | "music", event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsBusy(true);
    setBusyAction("uploading-asset");
    setProductionUploadType(type);
    setUploadProgress(0);
    setErrorMessage(undefined);
    try {
      if (type === "logo" && !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        throw new Error("Logo 仅支持 PNG、JPEG 或 WebP，建议使用透明 PNG。");
      }
      if (type === "music" && !["audio/mpeg", "audio/wav", "audio/x-wav"].includes(file.type)) {
        throw new Error("背景音乐仅支持 MP3 或 WAV。");
      }
      const limit = type === "logo" ? 25_000_000 : 80_000_000;
      if (file.size > limit) throw new Error(`${type === "logo" ? "Logo" : "背景音乐"}不能超过 ${type === "logo" ? "25MB" : "80MB"}。`);

      const descriptor = {
        projectId: project.id,
        versionId: project.currentVersion.id,
        type,
        name: file.name,
        size: file.size,
        contentType: file.type
      };
      const initResponse = await fetch("/api/production-assets/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(descriptor)
      });
      const session = await initResponse.json() as { key?: string; uploadUrl?: string; error?: string };
      if (!initResponse.ok || !session.key || !session.uploadUrl) throw new Error(session.error || "无法开始成片素材上传。");

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", session.uploadUrl!);
        xhr.setRequestHeader("content-type", file.type);
        xhr.upload.onprogress = (progressEvent) => {
          if (progressEvent.lengthComputable) {
            setUploadProgress(Math.min(96, Math.round((progressEvent.loaded / progressEvent.total) * 96)));
          }
        };
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error(`云端存储拒绝了上传（${xhr.status}）。`));
        xhr.onerror = () => reject(new Error("成片素材直传失败，请检查 R2 Bucket 的 CORS 设置。"));
        xhr.send(file);
      });

      const attachResponse = await fetch("/api/production-assets/attach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...descriptor, key: session.key })
      });
      const attached = await attachResponse.json() as { project?: Project; error?: string };
      if (!attachResponse.ok || !attached.project) throw new Error(attached.error || "无法应用成片素材。");
      setUploadProgress(100);
      setProject(attached.project);
      pushMessage({
        role: "assistant",
        type: "text",
        content: `${type === "logo" ? "品牌 Logo" : "背景音乐"}“${file.name}”已应用到当前成片。`,
        versionId: attached.project.currentVersion.id
      }, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "成片素材上传失败。";
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
      setProductionUploadType(undefined);
      setUploadProgress(undefined);
    }
  }

  async function removeProductionAsset(type: "logo" | "music") {
    setIsBusy(true);
    setBusyAction("saving-production");
    setErrorMessage(undefined);
    try {
      const response = await fetch("/api/production-assets/detach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, versionId: project.currentVersion.id, type })
      });
      const data = await response.json() as { project?: Project; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error || "无法移除成片素材。");
      setProject(data.project);
      pushMessage({
        role: "assistant",
        type: "text",
        content: `${type === "logo" ? "品牌 Logo" : "背景音乐"}已从当前成片移除。`,
        versionId: data.project.currentVersion.id
      }, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法移除成片素材。";
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function removeSceneAsset(assetId: string) {
    setIsBusy(true);
    try {
      const response = await fetch("/api/assets/detach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          versionId: project.currentVersion.id,
          sceneNumber: selectedScene,
          assetId
        })
      });
      const data = await response.json() as { error?: string; preserveRender?: boolean };
      if (!response.ok) throw new Error(data.error || "无法移除素材。");
      setProject((current) => ({
        ...current,
        currentVersion: {
          ...current.currentVersion,
          renderUrl: data.preserveRender ? current.currentVersion.renderUrl : undefined,
          renderJobId: data.preserveRender ? current.currentVersion.renderJobId : undefined,
          scenes: current.currentVersion.scenes.map((scene) => scene.sceneNumber === selectedScene
            ? { ...scene, assets: scene.assets.filter((asset) => asset.id !== assetId) }
            : scene)
        }
      }));
      pushMessage({
        role: "assistant",
        type: "text",
        content: `场景 ${selectedScene} 的素材已从当前版本移除。`,
        versionId: project.currentVersion.id
      }, true);
    } catch (error) {
      pushMessage({ role: "assistant", type: "text", content: error instanceof Error ? error.message : "无法移除素材。" });
    } finally {
      setIsBusy(false);
    }
  }

  async function regenerateImages(sceneNumbers?: number[], quality: "standard" | "premium" = "standard") {
    setIsBusy(true);
    setBusyAction("generating-images");
    setErrorMessage(undefined);
    setVersionsOpen(false);
    setVersionPreview(undefined);
    setAssetsOpen(false);
    try {
      const response = await fetch("/api/assets/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          versionId: project.currentVersion.id,
          sceneNumbers,
          quality
        }),
        signal: AbortSignal.timeout(125_000)
      });
      const data = await response.json() as MediaGenerationResponse;
      if (data.project) setProject(data.project);
      if (!response.ok || !data.project) throw new Error(data.error || "场景画面生成失败。");
      setInvalidRenderMedia((current) => withoutRepairedInvalidMedia(current, "visual", sceneNumbers));
      setGenerationIssues((current) => withoutRepairedGenerationIssues(current, "visual", sceneNumbers));
      pushMessage({
        role: "assistant",
        type: "text",
        content: sceneNumbers?.length === 1
          ? quality === "premium"
            ? `场景 ${sceneNumbers[0]} 已经提升为精细画质。`
            : `场景 ${sceneNumbers[0]} 的画面已经重新生成。`
          : "场景画面已经重新生成，可以继续播放或导出。",
        versionId: data.project.currentVersion.id
      }, true);
    } catch (error) {
      const message = requestErrorMessage(error, "场景画面生成失败，请稍后重试。");
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function generateImageCandidate(sceneNumber: number, instruction?: string) {
    setIsBusy(true);
    setBusyAction("generating-candidate");
    setErrorMessage(undefined);
    try {
      const response = await fetch("/api/assets/image/candidates/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          versionId: project.currentVersion.id,
          sceneNumber,
          instruction,
          quality: "standard"
        }),
        signal: AbortSignal.timeout(125_000)
      });
      const data = await response.json() as { project?: Project; candidate?: SceneAsset; error?: string };
      if (!response.ok || !data.project || !data.candidate) throw new Error(data.error || "候选画面生成失败。");
      setProject(data.project);
      setAssetsOpen(true);
      setCandidateToCompare({ sceneNumber, assetId: data.candidate.id });
      pushMessage({
        role: "assistant",
        type: "text",
        content: instruction
          ? `场景 ${sceneNumber} 已按“${compactText(instruction, "视觉修改", 42)}”生成候选画面。当前视频保持不变。`
          : `场景 ${sceneNumber} 新增了一张候选画面。当前视频保持不变，采用后才会创建新版本。`,
        versionId: data.project.currentVersion.id
      }, true);
    } catch (error) {
      const message = requestErrorMessage(error, "候选画面生成失败。");
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function regenerateAudio(sceneNumbers?: number[], narrationVoice?: NarrationVoice) {
    setIsBusy(true);
    setBusyAction("generating-audio");
    setErrorMessage(undefined);
    try {
      const response = await fetch("/api/assets/audio/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          versionId: project.currentVersion.id,
          sceneNumbers,
          narrationVoice
        }),
        signal: AbortSignal.timeout(125_000)
      });
      const data = await response.json() as MediaGenerationResponse;
      if (data.project) setProject(data.project);
      if (!response.ok || !data.project) throw new Error(data.error || "场景配音生成失败。");
      setInvalidRenderMedia((current) => withoutRepairedInvalidMedia(current, "audio", sceneNumbers));
      setGenerationIssues((current) => withoutRepairedGenerationIssues(current, "audio", sceneNumbers));
      pushMessage({
        role: "assistant",
        type: "text",
        content: sceneNumbers?.length === 1
          ? narrationVoice
            ? `场景 ${sceneNumbers[0]} 已切换为${narrationVoiceProfile(narrationVoice).label}，配音已经重新生成。`
            : `场景 ${sceneNumbers[0]} 的配音已经重新生成。`
          : "全部场景配音已经重新生成。",
        versionId: data.project.currentVersion.id
      }, true);
    } catch (error) {
      const message = requestErrorMessage(error, "场景配音生成失败，请稍后重试。");
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function requestVideoClips(
    baseProject: Project,
    sceneNumbers: number[],
    quality: "standard" | "premium"
  ) {
    let updatedProject = baseProject;
    for (const sceneNumber of sceneNumbers) {
      const response = await fetch("/api/assets/video/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: updatedProject.id,
          versionId: updatedProject.currentVersion.id,
          sceneNumbers: [sceneNumber],
          quality
        }),
        signal: AbortSignal.timeout(295_000)
      });
      const data = await response.json() as { project?: Project; error?: string };
      if (data.project) updatedProject = data.project;
      if (!response.ok || !data.project) throw new Error(data.error || "动态镜头生成失败。");
    }
    return updatedProject;
  }

  async function generateVideoClips(sceneNumbers: number[], quality: "standard" | "premium" = "standard") {
    setIsBusy(true);
    setBusyAction("generating-video");
    setErrorMessage(undefined);
    try {
      const updatedProject = await requestVideoClips(project, sceneNumbers, quality);
      setProject(updatedProject);
      setGenerationIssues((current) => withoutRepairedGenerationIssues(current, "clip", sceneNumbers));
      pushMessage({
        role: "assistant",
        type: "text",
        content: sceneNumbers.length === 1
          ? `场景 ${sceneNumbers[0]} 的动态视频镜头已经生成，预览与 MP4 导出将优先使用该镜头。`
          : `${sceneNumbers.length} 个场景的动态视频镜头已经生成。`,
        versionId: updatedProject.currentVersion.id
      }, true);
    } catch (error) {
      const message = requestErrorMessage(error, "动态镜头生成失败。");
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function exportVideo() {
    setErrorMessage(undefined);
    setExportProgress(5);
    let requestedJobId: string | undefined;
    try {
      const response = await fetch("/api/render-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, versionId: project.currentVersion.id })
      });
      const data = await response.json() as { renderJob?: RenderJob; error?: string; invalidMedia?: InvalidRenderMedia[] };
      if (!response.ok || !data.renderJob) {
        if (Array.isArray(data.invalidMedia) && data.invalidMedia.length > 0) {
          setInvalidRenderMedia(data.invalidMedia);
        }
        throw new Error(data.error || "MP4 渲染任务启动失败。");
      }
      setInvalidRenderMedia([]);
      const startedJob = data.renderJob;
      requestedJobId = startedJob.id;
      cancelledRenderIdsRef.current.delete(startedJob.id);
      setActiveRenderJobId(startedJob.id);
      setRenderJobs((current) => [startedJob, ...current.filter((job) => job.id !== startedJob.id)]);
      let completed: RenderJob | undefined = startedJob;
      if (completed.status === "queued" || completed.status === "running") {
        completed = await waitForRenderJob(
          completed.id,
          () => cancelledRenderIdsRef.current.has(startedJob.id),
          (progress) => {
            setExportProgress(progress);
            setRenderJobs((current) => current.map((job) => job.id === startedJob.id ? { ...job, progress } : job));
          }
        );
      }
      if (!completed) return;
      setRenderJobs((current) => [completed!, ...current.filter((job) => job.id !== completed!.id)]);
      if (completed.status !== "ready" || !completed.renderUrl) {
        throw new Error(completed.error || "MP4 渲染失败。");
      }
      setExportProgress(100);
      setProject((current) => ({
        ...current,
        currentVersion: { ...current.currentVersion, renderJobId: undefined, renderUrl: completed.renderUrl, status: "ready" }
      }));
      const anchor = document.createElement("a");
      anchor.href = completed.renderUrl;
      anchor.download = `${project.title}.mp4`;
      anchor.click();
      pushMessage({
        role: "assistant",
        type: "text",
        content: "1080p MP4 已完成合成并保存到云端。",
        versionId: completed.versionId
      }, true);
    } catch (error) {
      if (requestedJobId && cancelledRenderIdsRef.current.has(requestedJobId)) return;
      const message = error instanceof Error ? error.message : "视频导出失败。";
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setExportProgress(undefined);
      setActiveRenderJobId(undefined);
    }
  }

  function resetToBrief() {
    setStage("brief");
    setPendingPlan(undefined);
    setChatInput("");
    setErrorMessage(undefined);
    setInvalidRenderMedia([]);
    setGenerationIssues([]);
    setVersionsOpen(false);
    setVersionPreview(undefined);
    setExportsOpen(false);
    setAssetsOpen(false);
    setCandidateToCompare(undefined);
    setProductionOpen(false);
  }

  async function openProjects() {
    setStage("projects");
    setPendingPlan(undefined);
    setErrorMessage(undefined);
    setProjectsLoading(true);
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      const data = await response.json() as { projects?: ProjectListItem[]; error?: string };
      if (!response.ok) throw new Error(data.error || "项目列表读取失败。");
      setProjects(data.projects ?? []);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "项目列表读取失败。");
    } finally {
      setProjectsLoading(false);
    }
  }

  async function openProject(projectId: string) {
    setProjectsLoading(true);
    setErrorMessage(undefined);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const data = await response.json() as {
        project?: Project;
        messages?: ChatMessage[];
        pendingPlan?: EditPlan;
        error?: string;
      };
      if (!response.ok || !data.project || !data.messages) throw new Error(data.error || "项目读取失败。");
      setProject(data.project);
      setProjectSource("database");
      setMessages(data.messages);
      setSelectedScene(1);
      setPendingPlan(data.pendingPlan);
      setStudioView("preview");
      setVersions([]);
      setVersionPreview(undefined);
      setRenderJobs([]);
      setInvalidRenderMedia([]);
      setGenerationIssues([]);
      setVersionsOpen(false);
      setExportsOpen(false);
      setAssetsOpen(false);
      setCandidateToCompare(undefined);
      setProductionOpen(false);
      setActiveRenderJobId(data.project.currentVersion.renderJobId);
      setStage("studio");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "项目读取失败。");
    } finally {
      setProjectsLoading(false);
    }
  }

  async function renameProject(projectId: string, title: string) {
    if (!title) return false;
    setProjectActionBusy(true);
    setErrorMessage(undefined);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title })
      });
      const data = await response.json() as {
        project?: { id: string; title: string; updatedAt: string };
        error?: string;
      };
      if (!response.ok || !data.project) throw new Error(data.error || "项目重命名失败。");
      setProjects((current) => current.map((item) => item.id === projectId
        ? { ...item, title: data.project!.title, updatedAt: data.project!.updatedAt }
        : item));
      if (project.id === projectId) {
        setProject((current) => ({ ...current, title: data.project!.title }));
      }
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "项目重命名失败。");
      return false;
    } finally {
      setProjectActionBusy(false);
    }
  }

  async function deleteProject(projectId: string) {
    setProjectActionBusy(true);
    setErrorMessage(undefined);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
      const data = await response.json() as { deleted?: boolean; error?: string };
      if (!response.ok || !data.deleted) throw new Error(data.error || "项目删除失败。");
      setProjects((current) => current.filter((item) => item.id !== projectId));
      if (project.id === projectId) window.location.assign("/");
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "项目删除失败。");
      return false;
    } finally {
      setProjectActionBusy(false);
    }
  }

  return (
    <Shell
      onNewVideo={resetToBrief}
      onOpenProjects={() => void openProjects()}
      onOpenStudio={() => {
        if (projectSource !== "empty") setStage("studio");
      }}
      project={project}
      source={projectSource}
      stage={stage}
    >
      <input accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav" hidden onChange={uploadAsset} ref={fileInputRef} type="file" />
      <input accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void uploadProductionAsset("logo", event)} ref={logoInputRef} type="file" />
      <input accept="audio/mpeg,audio/wav" hidden onChange={(event) => void uploadProductionAsset("music", event)} ref={musicInputRef} type="file" />
      {stage === "studio" && errorMessage ? (
        <div className="kv-global-error" role="alert">
          <AlertCircle size={18} />
          <span>{errorMessage}</span>
          <button aria-label="关闭错误提示" onClick={() => setErrorMessage(undefined)} type="button"><X size={16} /></button>
        </div>
      ) : null}
      {stage === "brief" ? (
        <BriefScreen
          currentProject={project}
          isBusy={isBusy}
          onOpenStudio={() => setStage("studio")}
          onOptionsChange={setGenerationOptions}
          onPromptChange={setBriefPrompt}
          onSubmit={createVideo}
          onUseExample={setBriefPrompt}
          prompt={briefPrompt}
          options={generationOptions}
          hasCurrentProject={projectSource !== "empty"}
          errorMessage={errorMessage}
        />
      ) : null}
      {stage === "generating" ? (
        <GeneratingScreen
          motion={generationOptions.motion}
          progress={progress}
          prompt={generationPrompt}
          startedAt={generationStartedAt}
          status={generationStatus}
        />
      ) : null}
      {stage === "projects" ? (
        <ProjectLibrary
          actionBusy={projectActionBusy}
          errorMessage={errorMessage}
          isLoading={projectsLoading}
          onCreate={resetToBrief}
          onDelete={deleteProject}
          onOpen={(projectId) => void openProject(projectId)}
          onQueryChange={setProjectQuery}
          onRename={renameProject}
          projects={projects}
          query={projectQuery}
        />
      ) : null}
      {stage === "studio" ? (
        <StudioScreen
          busyAction={busyAction}
          input={chatInput}
          isBusy={isBusy}
          messages={messages}
          onApply={applyPlan}
          onCancel={cancelPlan}
          onInput={setChatInput}
          onPreviewPlan={previewPendingPlan}
          onSelectScene={setSelectedScene}
          onSubmit={submitChat}
          onUpload={() => fileInputRef.current?.click()}
          onRegenerate={regenerateImages}
          onEnhanceScene={(sceneNumber) => regenerateImages([sceneNumber], "premium")}
          onGenerateClip={(sceneNumber) => void generateVideoClips([sceneNumber])}
          onGenerateClips={(sceneNumbers) => void generateVideoClips(sceneNumbers)}
          onRegenerateAudio={regenerateAudio}
          onExport={exportVideo}
          exportProgress={exportProgress}
          activeRenderJobId={activeRenderJobId}
          renderJobs={renderJobs}
          invalidRenderMedia={invalidRenderMedia}
          generationIssues={generationIssues}
          exportsOpen={exportsOpen}
          exportsLoading={exportsLoading}
          onToggleExports={toggleExports}
          onCancelExport={(jobId) => void cancelExport(jobId)}
          versions={versions}
          versionsOpen={versionsOpen}
          versionsLoading={versionsLoading}
          versionPreview={versionPreview}
          versionPreviewLoading={versionPreviewLoading}
          onToggleVersions={toggleVersions}
          onPreviewVersion={(versionId) => void previewVersion(versionId)}
          onCloseVersionPreview={() => setVersionPreview(undefined)}
          onRestoreVersion={restoreVersion}
          uploadProgress={uploadProgress}
          assetsOpen={assetsOpen}
          candidateToCompare={candidateToCompare}
          onCandidateComparisonOpened={() => setCandidateToCompare(undefined)}
          onToggleAssets={toggleAssets}
          onRemoveAsset={removeSceneAsset}
          onGenerateCandidate={(sceneNumber, instruction) => void generateImageCandidate(sceneNumber, instruction)}
          productionOpen={productionOpen}
          productionUploadType={productionUploadType}
          onToggleProduction={toggleProduction}
          onUpdateProduction={(settings) => void updateProductionSettingsAction(settings)}
          onUploadProduction={(type) => (type === "logo" ? logoInputRef : musicInputRef).current?.click()}
          onRemoveProduction={(type) => void removeProductionAsset(type)}
          onMutateScene={(mutation) => void mutateSceneStructure(mutation)}
          onSaveScene={saveSceneEdits}
          onVoiceChange={(sceneNumber, voice) => void regenerateAudio([sceneNumber], voice)}
          onViewChange={setStudioView}
          pendingPlan={pendingPlan}
          project={project}
          selectedScene={selectedScene}
          view={studioView}
        />
      ) : null}
    </Shell>
  );
}
