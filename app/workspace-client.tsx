"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { PlayerRef } from "@remotion/player";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronRight,
  Clapperboard,
  Download,
  FileVideo2,
  Film,
  FolderOpen,
  History,
  ImagePlus,
  Layers3,
  Loader2,
  Mic2,
  Music2,
  PanelRightOpen,
  Pencil,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { KnowVideoPlayer } from "@/app/video-player";
import { VIDEO_FPS } from "@/video/config";
import type { ChatMessage, EditChange, EditPlan, GenerationOptions, Project, ProjectListItem, ProjectVersionSummary, RenderJob, Scene, SceneAsset } from "@/lib/types";

type Source = "database" | "mock";
type Stage = "brief" | "generating" | "projects" | "studio";
type Engine = "ai" | "heuristic";
type StudioView = "preview" | "storyboard";
type BusyAction =
  | "planning-edit"
  | "applying-edit"
  | "generating-images"
  | "generating-audio"
  | "saving-scene"
  | "uploading-asset"
  | "restoring-version";
const promptExamples = [
  "生成一个 30 秒的 AI 视频生成平台产品介绍视频，风格高级、节奏快、适合官网首屏。",
  "做一个关于跨境电商库存管理 SaaS 的解释视频，目标客户是运营负责人。",
  "制作一个教育产品宣传视频，展示老师如何用 AI 快速生成课程内容。"
];

const progressSteps = [
  "解析视频目标",
  "拆分场景和镜头",
  "撰写旁白与字幕",
  "生成视觉和运动提示词",
  "生成场景画面",
  "生成自然配音",
  "保存项目版本"
];

function durationLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}:${String(rest).padStart(2, "0")}` : `0:${String(rest).padStart(2, "0")}`;
}

function uniqueRegenerate(plan: EditPlan) {
  return Array.from(new Set(plan.changes.flatMap((change) => change.regenerate)))
    .map(assetTypeLabel)
    .join("、");
}

function assetTypeLabel(type: SceneAsset["type"]) {
  const labels: Record<SceneAsset["type"], string> = {
    image: "画面",
    audio: "配音",
    clip: "视频片段",
    thumbnail: "缩略图",
    caption: "字幕",
    render: "成片"
  };
  return labels[type];
}

function compactText(text: string | undefined, fallback: string, maxLength = 72) {
  if (!text) return fallback;
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

function fileSizeLabel(value: unknown) {
  const bytes = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "云端素材";
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
  return `${(bytes / 1_000_000).toFixed(bytes >= 10_000_000 ? 0 : 1)} MB`;
}

function sceneVisualAsset(scene: Scene) {
  return scene.assets.find((asset) => ["image", "clip"].includes(asset.type) && asset.url);
}

function requestErrorMessage(error: unknown, fallback: string) {
  if (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name)) {
    return `${fallback}请求超时，请稍后重试。`;
  }
  return error instanceof Error ? error.message : fallback;
}

function busyActionLabel(action?: BusyAction) {
  switch (action) {
    case "planning-edit":
      return "正在理解要求并生成逐场景修改方案";
    case "applying-edit":
      return "正在保存新版本并更新受影响素材";
    case "generating-images":
      return "正在生成场景画面，请保持页面打开";
    case "generating-audio":
      return "正在生成自然配音，请保持页面打开";
    case "saving-scene":
      return "正在保存场景并创建可恢复版本";
    case "uploading-asset":
      return "正在上传并应用场景素材";
    case "restoring-version":
      return "正在恢复历史版本";
    default:
      return "正在处理";
  }
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
  return (
    <main className="kv-shell">
      <aside className="kv-sidebar">
        <div className="kv-logo">K</div>
        <nav className="kv-nav">
          <button aria-label="新建视频" className={stage === "brief" ? "active" : ""} onClick={onNewVideo} type="button">
            <Plus size={18} />
          </button>
          <button aria-label="视频工作室" className={stage === "studio" ? "active" : ""} onClick={onOpenStudio} type="button">
            <Clapperboard size={18} />
          </button>
          <button aria-label="项目列表" className={stage === "projects" ? "active" : ""} onClick={onOpenProjects} type="button">
            <Layers3 size={18} />
          </button>
        </nav>
      </aside>
      <section className="kv-app">
        <header className="kv-topbar">
          <div>
            <span className="kv-eyebrow">Know Video 智能视频工作室</span>
            <h1>{stage === "brief" ? "用一句需求，完成一支视频" : stage === "projects" ? "我的视频项目" : project.title}</h1>
          </div>
          <div className="kv-status-row">
            <span>{source === "database" ? "项目已保存" : "本地预览"}</span>
            <span>智能分镜</span>
            <span>云端素材</span>
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
          </div>
          <div className="kv-prompt-tools">
            <span>参数会同时约束脚本、分镜、画面与配音。</span>
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
          <h3>{currentProject.title}</h3>
          <p>{currentProject.currentVersion.scenes.length} 个场景 · {durationLabel(currentProject.currentVersion.durationSeconds)}</p>
          <button onClick={onOpenStudio} type="button">
            打开工作室
            <ChevronRight size={16} />
          </button>
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

function GeneratingScreen({ prompt, progress, status }: { prompt: string; progress: number; status: string }) {
  const activeIndex = Math.min(progressSteps.length - 1, Math.floor(progress / (100 / progressSteps.length)));

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
      <div className="kv-progress-steps">
        {progressSteps.map((step, index) => (
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
  onSelect
}: {
  scenes: Scene[];
  selectedScene: number;
  onSelect: (scene: number) => void;
}) {
  return (
    <section className="kv-storyboard">
      <div className="kv-strip-heading">
        <h3>分镜时间线</h3>
        <span>{scenes.length} 个场景</span>
      </div>
      <div className="kv-scene-strip">
        {scenes.map((scene) => (
          <button
            className={scene.sceneNumber === selectedScene ? "active" : ""}
            key={scene.id}
            onClick={() => onSelect(scene.sceneNumber)}
            type="button"
          >
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
          </button>
        ))}
      </div>
    </section>
  );
}

type SceneTextEdits = Pick<Scene, "title" | "voiceover" | "visualPrompt" | "motionPrompt">;

function ScenePanel({
  scene,
  isBusy,
  onSave
}: {
  scene?: Scene;
  isBusy: boolean;
  onSave: (sceneNumber: number, edits: SceneTextEdits) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SceneTextEdits>({ title: "", voiceover: "", visualPrompt: "", motionPrompt: "" });
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
    setEditing(false);
  }, [scene?.id]);

  const changed = Boolean(scene) && (
    draft.title.trim() !== scene?.title
    || draft.voiceover.trim() !== scene?.voiceover
    || draft.visualPrompt.trim() !== scene?.visualPrompt
    || draft.motionPrompt.trim() !== scene?.motionPrompt
  );

  return (
    <section className="kv-scene-panel">
      <div className="kv-strip-heading">
        <div>
          <h3>{editing ? `编辑场景 ${scene?.sceneNumber ?? ""}` : "场景制作说明"}</h3>
          <span>{scene?.style.theme ?? "theme"} · {qualityLabel}</span>
        </div>
        {scene ? (
          <button disabled={isBusy} onClick={() => setEditing((current) => !current)} type="button">
            {editing ? <RotateCcw size={15} /> : <Pencil size={15} />}
            {editing ? "取消编辑" : "直接编辑"}
          </button>
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

function SceneAssetsPanel({
  scene,
  isBusy,
  uploadProgress,
  onUpload,
  onRemove
}: {
  scene: Scene;
  isBusy: boolean;
  uploadProgress?: number;
  onUpload: () => void;
  onRemove: (assetId: string) => void;
}) {
  const assets = scene.assets.filter((asset) => ["image", "clip", "audio"].includes(asset.type));
  return (
    <section className="kv-assets-panel">
      <div className="kv-strip-heading">
        <div>
          <span className="kv-eyebrow">场景 {scene.sceneNumber} 素材</span>
          <h3>管理当前画面、视频片段和配音</h3>
        </div>
        <button disabled={isBusy} onClick={onUpload} type="button">
          {uploadProgress !== undefined ? <Loader2 className="kv-spin" size={16} /> : <Upload size={16} />}
          {uploadProgress !== undefined ? `上传 ${uploadProgress}%` : "添加或替换"}
        </button>
      </div>
      <div className="kv-asset-list">
        {assets.length === 0 ? (
          <div className="kv-assets-empty"><ImagePlus size={20} />这个场景还没有可用素材</div>
        ) : assets.map((asset) => (
          <article key={asset.id}>
            {asset.type === "image" ? (
              <span className="kv-asset-preview" style={{ backgroundImage: `url("${asset.url}")` }} />
            ) : (
              <span className="kv-asset-preview icon">
                {asset.type === "clip" ? <FileVideo2 size={22} /> : <Music2 size={22} />}
              </span>
            )}
            <div>
              <strong>{String(asset.metadata?.name ?? (asset.type === "image" ? "场景画面" : asset.type === "clip" ? "视频片段" : "场景配音"))}</strong>
              <span>{asset.type === "image" ? "图片" : asset.type === "clip" ? "视频" : "音频"} · {fileSizeLabel(asset.metadata?.size)}</span>
            </div>
            <button aria-label={`移除 ${String(asset.metadata?.name ?? asset.type)}`} disabled={isBusy} onClick={() => onRemove(asset.id)} title="从当前版本移除" type="button">
              <Trash2 size={16} />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function ChangeCard({ change }: { change: EditChange }) {
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

function ChatPanel({
  messages,
  pendingPlan,
  input,
  isBusy,
  busyAction,
  onInput,
  onSubmit,
  onApply,
  onCancel
}: {
  messages: ChatMessage[];
  pendingPlan?: EditPlan;
  input: string;
  isBusy: boolean;
  busyAction?: BusyAction;
  onInput: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
  }, [messages.length, pendingPlan, isBusy]);

  return (
    <aside className="kv-chat">
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
                <span>影响场景：{message.editPlan.affectedScenes.join(", ")}</span>
                <span>重新生成：{uniqueRegenerate(message.editPlan)}</span>
              </div>
            ) : null}
          </div>
        ))}
        {pendingPlan ? (
          <section className="kv-review-plan">
            <div className="kv-strip-heading">
              <h3>确认修改方案</h3>
              <span>{pendingPlan.changes.length} 项修改</span>
            </div>
            <p>{pendingPlan.summary}</p>
            <div className="kv-change-list">
              {pendingPlan.changes.map((change) => (
                <ChangeCard change={change} key={change.sceneNumber} />
              ))}
            </div>
            <div className="kv-review-actions">
              <button className="kv-primary" disabled={isBusy} onClick={onApply} type="button">
                {isBusy ? <Loader2 className="kv-spin" size={16} /> : <Check size={16} />}
                应用修改
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
      <form className="kv-chat-form" onSubmit={onSubmit}>
        <textarea
          disabled={isBusy}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
          onChange={(event) => onInput(event.target.value)}
          placeholder="例如：把第 2 场景改成浅色；让整体更电影感；缩短旁白…"
          value={input}
        />
        <button disabled={isBusy || input.trim().length === 0} type="submit">
          {isBusy ? <Loader2 className="kv-spin" size={18} /> : <Send size={18} />}
        </button>
      </form>
    </aside>
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
  onApply,
  onCancel,
  onSelectScene,
  onViewChange,
  onUpload,
  onRegenerate,
  onEnhanceScene,
  onRegenerateAudio,
  onExport,
  exportProgress,
  versions,
  versionsOpen,
  versionsLoading,
  onToggleVersions,
  onRestoreVersion,
  uploadProgress,
  assetsOpen,
  onToggleAssets,
  onRemoveAsset,
  onSaveScene
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
  onApply: () => void;
  onCancel: () => void;
  onSelectScene: (scene: number) => void;
  onViewChange: (view: StudioView) => void;
  onUpload: () => void;
  onRegenerate: (sceneNumbers?: number[]) => void;
  onEnhanceScene: (sceneNumber: number) => void;
  onRegenerateAudio: (sceneNumbers?: number[]) => void;
  onExport: () => void;
  exportProgress?: number;
  versions: ProjectVersionSummary[];
  versionsOpen: boolean;
  versionsLoading: boolean;
  onToggleVersions: () => void;
  onRestoreVersion: (versionId: string) => void;
  uploadProgress?: number;
  assetsOpen: boolean;
  onToggleAssets: () => void;
  onRemoveAsset: (assetId: string) => void;
  onSaveScene: (sceneNumber: number, edits: SceneTextEdits) => void;
}) {
  const playerRef = useRef<PlayerRef>(null);
  const scene = project.currentVersion.scenes.find((item) => item.sceneNumber === selectedScene) ?? project.currentVersion.scenes[0];
  const missingSceneNumbers = project.currentVersion.scenes
    .filter((item) => !sceneVisualAsset(item))
    .map((item) => item.sceneNumber);
  const missingAudioSceneNumbers = project.currentVersion.scenes
    .filter((item) => !item.assets.some((asset) => asset.type === "audio" && asset.url))
    .map((item) => item.sceneNumber);
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const handleFrameUpdate = ({ detail }: { detail: { frame: number } }) => {
      const seconds = detail.frame / VIDEO_FPS;
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
  }, [onSelectScene, project.currentVersion.id, project.currentVersion.scenes, selectedScene]);

  function selectScene(sceneNumber: number) {
    const seconds = project.currentVersion.scenes
      .filter((item) => item.sceneNumber < sceneNumber)
      .reduce((sum, item) => sum + item.durationSeconds, 0);
    playerRef.current?.seekTo(Math.round(seconds * VIDEO_FPS));
    onSelectScene(sceneNumber);
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
            <button className={versionsOpen ? "active" : ""} onClick={onToggleVersions} type="button">
              <History size={16} />
              版本
            </button>
            <button className={assetsOpen ? "active" : ""} disabled={isBusy} onClick={onToggleAssets} type="button">
              {uploadProgress !== undefined ? <Loader2 className="kv-spin" size={16} /> : <ImagePlus size={16} />}
              {uploadProgress !== undefined ? `上传 ${uploadProgress}%` : "素材"}
            </button>
            <button disabled={isBusy} onClick={() => onRegenerate(missingSceneNumbers.length > 0 ? missingSceneNumbers : undefined)} type="button">
              <RefreshCcw size={16} />
              重新生成画面
            </button>
            <button disabled={isBusy} onClick={() => onEnhanceScene(selectedScene)} type="button">
              <Sparkles size={16} />
              提升本场景画质
            </button>
            <button
              disabled={isBusy}
              onClick={() => onRegenerateAudio(missingAudioSceneNumbers.length > 0 ? missingAudioSceneNumbers : [selectedScene])}
              type="button"
            >
              <Mic2 size={16} />
              {missingAudioSceneNumbers.length > 0 ? `补齐 ${missingAudioSceneNumbers.length} 段配音` : "重做本场景配音"}
            </button>
            <button
              className="kv-primary"
              disabled={isBusy || exportProgress !== undefined || missingSceneNumbers.length > 0 || missingAudioSceneNumbers.length > 0}
              onClick={onExport}
              type="button"
            >
              {exportProgress !== undefined ? <Loader2 className="kv-spin" size={16} /> : <Download size={16} />}
              {exportProgress !== undefined
                ? `正在合成 MP4 ${exportProgress}%`
                : project.currentVersion.renderUrl
                  ? "下载 MP4"
                  : "导出 MP4"}
            </button>
          </div>
        </div>
        {missingAudioSceneNumbers.length > 0 ? (
          <div className="kv-media-warning" role="status">
            <Mic2 size={17} />
            <span>还有 {missingAudioSceneNumbers.length} 个场景缺少配音。补齐后才能导出 MP4，避免生成静音或旁白不完整的视频。</span>
            <button disabled={isBusy} onClick={() => onRegenerateAudio(missingAudioSceneNumbers)} type="button">
              {isBusy ? <Loader2 className="kv-spin" size={15} /> : <RefreshCcw size={15} />}
              生成缺失配音
            </button>
          </div>
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
                    <p>{version.sceneCount} 个场景 · {durationLabel(version.durationSeconds)}</p>
                    <time>{new Date(version.createdAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
                    {!version.isCurrent ? (
                      <button disabled={isBusy} onClick={() => onRestoreVersion(version.id)} type="button">
                        <RotateCcw size={15} />恢复为新版本
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}
        {assetsOpen ? (
          <SceneAssetsPanel
            isBusy={isBusy}
            onRemove={onRemoveAsset}
            onUpload={onUpload}
            scene={scene}
            uploadProgress={uploadProgress}
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
            <Storyboard onSelect={selectScene} scenes={project.currentVersion.scenes} selectedScene={selectedScene} />
            <ScenePanel isBusy={isBusy} onSave={onSaveScene} scene={scene} />
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
        onSubmit={onSubmit}
        pendingPlan={pendingPlan}
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
  const [studioView, setStudioView] = useState<StudioView>("preview");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [exportProgress, setExportProgress] = useState<number | undefined>();
  const [versions, setVersions] = useState<ProjectVersionSummary[]>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | undefined>();
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [generationOptions, setGenerationOptions] = useState<GenerationOptions>({
    duration: "30",
    sceneCount: "auto",
    language: "中文",
    style: "电影质感"
  });
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [projectQuery, setProjectQuery] = useState("");
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectActionBusy, setProjectActionBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const generationPrompt = useMemo(() => briefPrompt.trim(), [briefPrompt]);

  function pushMessage(message: Omit<ChatMessage, "id">) {
    setMessages((current) => {
      const last = current[current.length - 1];
      if (last?.role === message.role && last.content === message.content) return current;
      return [...current, { ...message, id: crypto.randomUUID() }];
    });
  }

  async function createVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = generationPrompt;
    if (!prompt) return;

    setIsBusy(true);
    setErrorMessage(undefined);
    setProgress(8);
    setGenerationStatus("正在理解视频需求");
    setStage("generating");

    try {
      setProgress(18);
      setGenerationStatus("正在规划脚本与分镜");
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, options: generationOptions }),
        signal: AbortSignal.timeout(90_000)
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(failure.error || "视频项目创建失败。");
      }
      const data = await response.json() as {
        project: Project;
        messages: ChatMessage[];
        engine: Engine;
      };
      let generatedProject = data.project;
      const warnings: string[] = [];
      setProject(generatedProject);
      setProjects([]);
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

      setProgress(64);
      setGenerationStatus("正在生成统一风格的场景画面");
      try {
        const imageResponse = await fetch("/api/assets/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: generatedProject.id,
            versionId: generatedProject.currentVersion.id,
            quality: "standard"
          }),
          signal: AbortSignal.timeout(125_000)
        });
        const imageData = await imageResponse.json() as { project?: Project; error?: string };
        if (imageData.project) {
          generatedProject = imageData.project;
          setProject(generatedProject);
        }
        if (!imageResponse.ok) warnings.push(imageData.error || "部分场景画面生成失败。");
      } catch (error) {
        warnings.push(requestErrorMessage(error, "场景画面生成失败。"));
      }

      setProgress(84);
      setGenerationStatus("正在生成自然配音");
      try {
        const audioResponse = await fetch("/api/assets/audio/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: generatedProject.id,
            versionId: generatedProject.currentVersion.id
          }),
          signal: AbortSignal.timeout(125_000)
        });
        const audioData = await audioResponse.json() as { project?: Project; error?: string };
        if (audioData.project) {
          generatedProject = audioData.project;
          setProject(generatedProject);
        }
        if (!audioResponse.ok) warnings.push(audioData.error || "部分场景配音生成失败。");
      } catch (error) {
        warnings.push(requestErrorMessage(error, "场景配音生成失败。"));
      }

      setGenerationStatus("正在保存可继续编辑的项目");
      setProgress(96);
      if (warnings.length > 0) setErrorMessage(Array.from(new Set(warnings)).join(" "));
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        type: "text",
        content: warnings.length > 0
          ? "脚本和分镜已经保存，部分媒体素材需要在工作室中重试。"
          : "全部场景画面和配音已经完成，可以播放预览或继续通过对话修改。"
      }]);
      setSelectedScene(1);
      setPendingPlan(undefined);
      setStudioView("preview");
      setProgress(100);
      window.setTimeout(() => setStage("studio"), 350);
    } catch (error) {
      console.error(error);
      setStage("brief");
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
    setIsBusy(true);
    setBusyAction("planning-edit");
    setErrorMessage(undefined);
    pushMessage({ role: "user", type: "text", content: request });

    try {
      const response = await fetch("/api/edit-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          versionId: project.currentVersion.id,
          request
        }),
        signal: AbortSignal.timeout(45_000)
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(failure.error || "修改计划生成失败，请重试。");
      }
      const data = await response.json() as {
        editPlan: EditPlan;
        messages: ChatMessage[];
      };
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
      regeneration: { imageSceneNumbers: number[]; audioSceneNumbers: number[] };
    };
    let updatedProject = data.project;
    const warnings: string[] = [];
    setProject(updatedProject);
    setMessages((current) => [...current, data.message]);
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

    const completionMessage = warnings.length > 0
      ? `文字修改和新版本已经保存。${Array.from(new Set(warnings)).join(" ")}`
      : data.regeneration.imageSceneNumbers.length > 0 || data.regeneration.audioSceneNumbers.length > 0
        ? "修改内容和受影响素材已经全部更新。"
        : "修改内容已经保存。";
    setMessages((current) => [...current, {
      id: crypto.randomUUID(),
      role: "assistant",
      type: "text",
      content: completionMessage,
      versionId: updatedProject.currentVersion.id
    }]);
    if (warnings.length > 0) setErrorMessage(Array.from(new Set(warnings)).join(" "));
    setBusyAction("applying-edit");
    return updatedProject;
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

  function toggleVersions() {
    const next = !versionsOpen;
    setVersionsOpen(next);
    if (next) setAssetsOpen(false);
    if (next) void loadVersions();
  }

  function toggleAssets() {
    setAssetsOpen((current) => !current);
    setVersionsOpen(false);
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
      if (file.size > 500_000_000) throw new Error("单个素材不能超过 500MB。");
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
            ? { ...scene, assets: [uploadedAsset, ...scene.assets.filter((asset) => asset.type !== uploadedAsset.type)] }
            : scene)
        }
      }));
      pushMessage({
        role: "assistant",
        type: "text",
        content: `素材“${String(uploadedAsset.metadata?.name ?? "未命名素材")}”已应用到场景 ${selectedScene}。`
      });
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
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "无法移除素材。");
      setProject((current) => ({
        ...current,
        currentVersion: {
          ...current.currentVersion,
          renderUrl: undefined,
          scenes: current.currentVersion.scenes.map((scene) => scene.sceneNumber === selectedScene
            ? { ...scene, assets: scene.assets.filter((asset) => asset.id !== assetId) }
            : scene)
        }
      }));
      pushMessage({ role: "assistant", type: "text", content: `场景 ${selectedScene} 的素材已从当前版本移除。` });
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
        })
      });
      const data = await response.json() as { project?: Project; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error || "场景画面生成失败。");
      setProject(data.project);
      pushMessage({
        role: "assistant",
        type: "text",
        content: sceneNumbers?.length === 1
          ? quality === "premium"
            ? `场景 ${sceneNumbers[0]} 已经提升为精细画质。`
            : `场景 ${sceneNumbers[0]} 的画面已经重新生成。`
          : "场景画面已经重新生成，可以继续播放或导出。"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "场景画面生成失败。";
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function regenerateAudio(sceneNumbers?: number[]) {
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
          sceneNumbers
        })
      });
      const data = await response.json() as { project?: Project; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error || "场景配音生成失败。");
      setProject(data.project);
      pushMessage({
        role: "assistant",
        type: "text",
        content: sceneNumbers?.length === 1
          ? `场景 ${sceneNumbers[0]} 的配音已经重新生成。`
          : "全部场景配音已经重新生成。"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "场景配音生成失败。";
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function exportVideo() {
    setErrorMessage(undefined);
    if (project.currentVersion.renderUrl) {
      const anchor = document.createElement("a");
      anchor.href = project.currentVersion.renderUrl;
      anchor.download = `${project.title}.mp4`;
      anchor.click();
      return;
    }
    setExportProgress(5);
    try {
      const response = await fetch("/api/render-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, versionId: project.currentVersion.id })
      });
      const data = await response.json() as { renderJob?: RenderJob; error?: string };
      if (!response.ok || !data.renderJob) throw new Error(data.error || "MP4 渲染任务启动失败。");
      let completed = data.renderJob;
      const startedAt = Date.now();
      while (completed.status === "queued" || completed.status === "running") {
        if (Date.now() - startedAt > 45 * 60 * 1000) {
          throw new Error("视频渲染超时，请稍后在项目中重试导出。");
        }
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        const statusResponse = await fetch(`/api/render-jobs?id=${encodeURIComponent(completed.id)}`, {
          cache: "no-store"
        });
        const statusData = await statusResponse.json() as { renderJob?: RenderJob; error?: string };
        if (!statusResponse.ok || !statusData.renderJob) {
          throw new Error(statusData.error || "无法读取视频渲染进度。");
        }
        completed = statusData.renderJob;
        setExportProgress(completed.progress);
      }
      if (completed.status !== "ready" || !completed.renderUrl) {
        throw new Error(completed.error || "MP4 渲染失败。");
      }
      setExportProgress(100);
      setProject((current) => ({
        ...current,
        currentVersion: { ...current.currentVersion, renderUrl: completed.renderUrl, status: "ready" }
      }));
      const anchor = document.createElement("a");
      anchor.href = completed.renderUrl;
      anchor.download = `${project.title}.mp4`;
      anchor.click();
      pushMessage({ role: "assistant", type: "text", content: "1080p MP4 已完成合成并保存到云端。" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "视频导出失败。";
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setExportProgress(undefined);
    }
  }

  function resetToBrief() {
    setStage("brief");
    setPendingPlan(undefined);
    setChatInput("");
    setErrorMessage(undefined);
    setVersionsOpen(false);
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
      setMessages(data.messages);
      setSelectedScene(1);
      setPendingPlan(data.pendingPlan);
      setStudioView("preview");
      setVersions([]);
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
      onOpenStudio={() => setStage("studio")}
      project={project}
      source={source}
      stage={stage}
    >
      <input accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav" hidden onChange={uploadAsset} ref={fileInputRef} type="file" />
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
          errorMessage={errorMessage}
        />
      ) : null}
      {stage === "generating" ? (
        <GeneratingScreen progress={progress} prompt={generationPrompt} status={generationStatus} />
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
          onSelectScene={setSelectedScene}
          onSubmit={submitChat}
          onUpload={() => fileInputRef.current?.click()}
          onRegenerate={regenerateImages}
          onEnhanceScene={(sceneNumber) => regenerateImages([sceneNumber], "premium")}
          onRegenerateAudio={regenerateAudio}
          onExport={exportVideo}
          exportProgress={exportProgress}
          versions={versions}
          versionsOpen={versionsOpen}
          versionsLoading={versionsLoading}
          onToggleVersions={toggleVersions}
          onRestoreVersion={restoreVersion}
          uploadProgress={uploadProgress}
          assetsOpen={assetsOpen}
          onToggleAssets={toggleAssets}
          onRemoveAsset={removeSceneAsset}
          onSaveScene={saveSceneEdits}
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
