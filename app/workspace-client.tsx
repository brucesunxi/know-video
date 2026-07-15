"use client";

import { ChangeEvent, FormEvent, useMemo, useRef, useState } from "react";
import type { PlayerRef } from "@remotion/player";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronRight,
  Clapperboard,
  Download,
  Film,
  ImagePlus,
  Layers3,
  Loader2,
  Mic2,
  PanelRightOpen,
  Plus,
  RefreshCcw,
  Send,
  Settings2,
  Sparkles,
  Upload
} from "lucide-react";
import { KnowVideoPlayer } from "@/app/video-player";
import { VIDEO_FPS } from "@/video/config";
import type { ChatMessage, EditChange, EditPlan, Project, RenderJob, Scene } from "@/lib/types";

type Source = "database" | "mock";
type Stage = "brief" | "generating" | "studio";
type Engine = "ai" | "heuristic";
type StudioView = "preview" | "storyboard";

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
  "保存项目版本"
];

function durationLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}:${String(rest).padStart(2, "0")}` : `0:${String(rest).padStart(2, "0")}`;
}

function uniqueRegenerate(plan: EditPlan) {
  return Array.from(new Set(plan.changes.flatMap((change) => change.regenerate))).join(", ");
}

function compactText(text: string | undefined, fallback: string, maxLength = 72) {
  if (!text) return fallback;
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

function Shell({
  children,
  project,
  source,
  stage,
  onNewVideo
}: {
  children: React.ReactNode;
  project: Project;
  source: Source;
  stage: Stage;
  onNewVideo: () => void;
}) {
  return (
    <main className="kv-shell">
      <aside className="kv-sidebar">
        <div className="kv-logo">K</div>
        <nav className="kv-nav">
          <button aria-label="新建视频" className={stage === "brief" ? "active" : ""} onClick={onNewVideo} type="button">
            <Plus size={18} />
          </button>
          <button aria-label="视频工作室" className={stage === "studio" ? "active" : ""} type="button">
            <Clapperboard size={18} />
          </button>
          <button aria-label="项目列表" type="button">
            <Layers3 size={18} />
          </button>
          <button aria-label="设置" type="button">
            <Settings2 size={18} />
          </button>
        </nav>
      </aside>
      <section className="kv-app">
        <header className="kv-topbar">
          <div>
            <span className="kv-eyebrow">Know Video 智能视频工作室</span>
            <h1>{stage === "brief" ? "用一句需求，完成一支视频" : project.title}</h1>
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

function BriefScreen({
  prompt,
  isBusy,
  currentProject,
  onPromptChange,
  onUseExample,
  onSubmit,
  onOpenStudio,
  errorMessage
}: {
  prompt: string;
  isBusy: boolean;
  currentProject: Project;
  onPromptChange: (value: string) => void;
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
          <div className="kv-prompt-tools">
            <button type="button">
              <Upload size={18} />
              参考素材
            </button>
            <button type="button">
              <Mic2 size={18} />
              语音输入
            </button>
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
          <p>{currentProject.currentVersion.scenes.length} scenes · {durationLabel(currentProject.currentVersion.durationSeconds)}</p>
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

function GeneratingScreen({ prompt, progress }: { prompt: string; progress: number }) {
  const activeIndex = Math.min(progressSteps.length - 1, Math.floor(progress / (100 / progressSteps.length)));

  return (
    <div className="kv-generating">
      <div className="kv-render-orbit">
        <Film size={44} />
        <span />
      </div>
      <div className="kv-section-heading centered">
        <span className="kv-pill">正在制作</span>
        <h2>正在生成脚本、分镜和场景画面</h2>
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
            ) : <span className="kv-scene-thumb empty"><ImagePlus size={18} /></span>}
            <span className="kv-scene-number">S{scene.sceneNumber}</span>
            <strong>{scene.title}</strong>
            <small>{scene.durationSeconds} 秒</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function ScenePanel({ scene }: { scene?: Scene }) {
  return (
    <section className="kv-scene-panel">
      <div className="kv-strip-heading">
        <h3>场景制作说明</h3>
        <span>{scene?.style.theme ?? "theme"}</span>
      </div>
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
          ) : <div className="kv-board-image empty"><ImagePlus size={24} /><span>等待生成画面</span></div>}
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

function ChangeCard({ change }: { change: EditChange }) {
  return (
    <article className="kv-change">
      <div>
        <strong>场景 {change.sceneNumber}</strong>
        <span>{change.status}</span>
      </div>
      <p>{change.after.visualPrompt}</p>
    </article>
  );
}

function ChatPanel({
  messages,
  pendingPlan,
  input,
  isBusy,
  onInput,
  onSubmit,
  onApply,
  onCancel
}: {
  messages: ChatMessage[];
  pendingPlan?: EditPlan;
  input: string;
  isBusy: boolean;
  onInput: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    <aside className="kv-chat">
      <header>
        <div>
          <span className="kv-eyebrow">对话式改片</span>
          <h3>告诉我你想怎么改</h3>
        </div>
        <PanelRightOpen size={20} />
      </header>
      <div className="kv-chat-log">
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
      </div>
      <form className="kv-chat-form" onSubmit={onSubmit}>
        <textarea
          disabled={isBusy}
          onChange={(event) => onInput(event.target.value)}
          placeholder="例如：把第 2 场景改成浅色；让整体更电影感；缩短旁白..."
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
  onInput,
  onSubmit,
  onApply,
  onCancel,
  onSelectScene,
  onViewChange,
  onUpload,
  onRegenerate,
  onExport,
  exportProgress
}: {
  project: Project;
  messages: ChatMessage[];
  pendingPlan?: EditPlan;
  input: string;
  selectedScene: number;
  view: StudioView;
  isBusy: boolean;
  onInput: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onApply: () => void;
  onCancel: () => void;
  onSelectScene: (scene: number) => void;
  onViewChange: (view: StudioView) => void;
  onUpload: () => void;
  onRegenerate: (sceneNumbers?: number[]) => void;
  onExport: () => void;
  exportProgress?: number;
}) {
  const playerRef = useRef<PlayerRef>(null);
  const scene = project.currentVersion.scenes.find((item) => item.sceneNumber === selectedScene) ?? project.currentVersion.scenes[0];
  const missingSceneNumbers = project.currentVersion.scenes
    .filter((item) => !item.assets.some((asset) => asset.type === "image" && asset.url))
    .map((item) => item.sceneNumber);
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
            <button onClick={onUpload} type="button">
              <ImagePlus size={16} />
              素材
            </button>
            <button disabled={isBusy} onClick={() => onRegenerate(missingSceneNumbers.length > 0 ? missingSceneNumbers : undefined)} type="button">
              <RefreshCcw size={16} />
              重新生成画面
            </button>
            <button className="kv-primary" disabled={isBusy || exportProgress !== undefined} onClick={onExport} type="button">
              {exportProgress !== undefined ? <Loader2 className="kv-spin" size={16} /> : <Download size={16} />}
              {exportProgress !== undefined ? `正在合成 MP4 ${exportProgress}%` : "导出 MP4"}
            </button>
          </div>
        </div>
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
            <ScenePanel scene={scene} />
          </>
        ) : (
          <StoryboardBoard scenes={project.currentVersion.scenes} />
        )}
      </section>
      <ChatPanel
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
  source
}: {
  initialProject: Project;
  initialMessages: ChatMessage[];
  source: Source;
}) {
  const [project, setProject] = useState(initialProject);
  const [stage, setStage] = useState<Stage>("brief");
  const [briefPrompt, setBriefPrompt] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [selectedScene, setSelectedScene] = useState(1);
  const [pendingPlan, setPendingPlan] = useState<EditPlan | undefined>();
  const [isBusy, setIsBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [studioView, setStudioView] = useState<StudioView>("preview");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [exportProgress, setExportProgress] = useState<number | undefined>();
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
    setStage("generating");

    const timer = window.setInterval(() => {
      setProgress((value) => Math.min(92, value + 12));
    }, 520);

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt })
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

      setProject(data.project);
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
      if (data.project.currentVersion.assetStatus !== "ready") {
        const errorMessages = {
          missing_key: "脚本和分镜已经完成，但图片服务尚未配置。",
          invalid_key: "脚本和分镜已经完成，但图片服务凭证无效，请更新 Vercel 中的服务配置。",
          storage_failed: "脚本和分镜已经完成，但场景图片写入云端存储失败。",
          generation_failed: "脚本和分镜已经完成，但部分场景画面生成失败。"
        } as const;
        setErrorMessage(
          data.project.currentVersion.assetErrorCode
            ? errorMessages[data.project.currentVersion.assetErrorCode]
            : "脚本和分镜已经完成，但部分场景画面生成失败。"
        );
      }
      setSelectedScene(1);
      setPendingPlan(undefined);
      setStudioView("preview");
      setProgress(100);
      window.setTimeout(() => setStage("studio"), 350);
    } catch (error) {
      console.error(error);
      setStage("brief");
      setErrorMessage(error instanceof Error ? error.message : "生成失败，请稍后重试。");
      pushMessage({
        role: "assistant",
        type: "text",
        content: "生成失败。请检查模型 Key、Vercel 日志或数据库连接。"
      });
    } finally {
      window.clearInterval(timer);
      setIsBusy(false);
    }
  }

  async function submitChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = chatInput.trim();
    if (!request) return;

    setChatInput("");
    setIsBusy(true);
    pushMessage({ role: "user", type: "text", content: request });

    try {
      const response = await fetch("/api/edit-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          versionId: project.currentVersion.id,
          request
        })
      });
      if (!response.ok) throw new Error("Failed to create edit plan.");
      const data = await response.json() as {
        editPlan: EditPlan;
        messages: ChatMessage[];
      };
      setPendingPlan(data.editPlan);
      setMessages((current) => [...current, ...data.messages.filter((message) => message.role === "assistant")]);
    } catch (error) {
      console.error(error);
      pushMessage({
        role: "assistant",
        type: "text",
        content: "没有生成修改计划。请稍后重试或检查服务端日志。"
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function applyPlan() {
    if (!pendingPlan) return;

    setIsBusy(true);
    try {
      const response = await fetch("/api/edit-plan/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project, editPlan: pendingPlan })
      });
      if (!response.ok) throw new Error("Failed to apply edit plan.");
      const data = await response.json() as {
        project: Project;
        message: ChatMessage;
      };
      setProject(data.project);
      setPendingPlan(undefined);
      setMessages((current) => [...current, data.message]);
    } catch (error) {
      console.error(error);
      pushMessage({
        role: "assistant",
        type: "text",
        content: "应用修改失败。请检查 Vercel 日志。"
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function uploadAsset(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("projectId", project.id);
      const response = await fetch("/api/assets/upload", {
        method: "POST",
        body: form
      });
      if (!response.ok) throw new Error("Upload failed.");
      const data = await response.json() as { asset: { r2Key: string; metadata?: { name?: string } } };
      pushMessage({
        role: "assistant",
        type: "text",
        content: `素材已上传到 R2：${data.asset.metadata?.name ?? "asset"}。路径：${data.asset.r2Key}`
      });
    } catch (error) {
      console.error(error);
      pushMessage({
        role: "assistant",
        type: "text",
        content: "素材上传失败，请检查 R2 配置。"
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function regenerateImages(sceneNumbers?: number[]) {
    setIsBusy(true);
    setErrorMessage(undefined);
    try {
      const response = await fetch("/api/assets/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project, sceneNumbers })
      });
      const data = await response.json() as { project?: Project; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error || "场景画面生成失败。");
      setProject(data.project);
      pushMessage({
        role: "assistant",
        type: "text",
        content: sceneNumbers?.length === 1
          ? `场景 ${sceneNumbers[0]} 的画面已经重新生成。`
          : "场景画面已经重新生成，可以继续播放或导出。"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "场景画面生成失败。";
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setIsBusy(false);
    }
  }

  async function exportVideo() {
    setErrorMessage(undefined);
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
  }

  return (
    <Shell onNewVideo={resetToBrief} project={project} source={source} stage={stage}>
      <input hidden onChange={uploadAsset} ref={fileInputRef} type="file" />
      {stage === "brief" ? (
        <BriefScreen
          currentProject={project}
          isBusy={isBusy}
          onOpenStudio={() => setStage("studio")}
          onPromptChange={setBriefPrompt}
          onSubmit={createVideo}
          onUseExample={setBriefPrompt}
          prompt={briefPrompt}
          errorMessage={errorMessage}
        />
      ) : null}
      {stage === "generating" ? (
        <GeneratingScreen progress={progress} prompt={generationPrompt} />
      ) : null}
      {stage === "studio" ? (
        <StudioScreen
          input={chatInput}
          isBusy={isBusy}
          messages={messages}
          onApply={applyPlan}
          onCancel={() => setPendingPlan(undefined)}
          onInput={setChatInput}
          onSelectScene={setSelectedScene}
          onSubmit={submitChat}
          onUpload={() => fileInputRef.current?.click()}
          onRegenerate={regenerateImages}
          onExport={exportVideo}
          exportProgress={exportProgress}
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
