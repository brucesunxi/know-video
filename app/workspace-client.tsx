"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
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
  Play,
  Plus,
  RefreshCcw,
  Send,
  Settings2,
  Sparkles,
  Upload
} from "lucide-react";
import type { ChatMessage, EditChange, EditPlan, Project, Scene } from "@/lib/types";

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

function sceneAtTime(scenes: Scene[], seconds: number) {
  let cursor = 0;
  for (const scene of scenes) {
    cursor += scene.durationSeconds;
    if (seconds < cursor) return scene.sceneNumber;
  }

  return scenes[scenes.length - 1]?.sceneNumber ?? 1;
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
          <button className={stage === "brief" ? "active" : ""} onClick={onNewVideo} type="button">
            <Plus size={18} />
          </button>
          <button className={stage === "studio" ? "active" : ""} type="button">
            <Clapperboard size={18} />
          </button>
          <button type="button">
            <Layers3 size={18} />
          </button>
          <button type="button">
            <Settings2 size={18} />
          </button>
        </nav>
      </aside>
      <section className="kv-app">
        <header className="kv-topbar">
          <div>
            <span className="kv-eyebrow">AI Video Studio</span>
            <h1>{stage === "brief" ? "Create a video from one request" : project.title}</h1>
          </div>
          <div className="kv-status-row">
            <span>{source === "database" ? "Neon connected" : "Local fallback"}</span>
            <span>AI planning engine</span>
            <span>R2 storage</span>
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
  onOpenStudio
}: {
  prompt: string;
  isBusy: boolean;
  currentProject: Project;
  onPromptChange: (value: string) => void;
  onUseExample: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onOpenStudio: () => void;
}) {
  return (
    <div className="kv-brief">
      <section className="kv-brief-main">
        <div className="kv-section-heading">
          <span className="kv-pill">Text to video</span>
          <h2>Describe the video. The system plans scenes, script, motion, and edit checkpoints.</h2>
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
          <span className="kv-eyebrow">Current project</span>
          <h3>{currentProject.title}</h3>
          <p>{currentProject.currentVersion.scenes.length} scenes · {durationLabel(currentProject.currentVersion.durationSeconds)}</p>
          <button onClick={onOpenStudio} type="button">
            打开工作室
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="kv-side-panel">
          <span className="kv-eyebrow">Pipeline</span>
          <ol className="kv-mini-steps">
            <li>AI engine creates storyboard JSON</li>
            <li>Neon stores projects, versions, scenes</li>
            <li>R2 stores uploads and generated assets</li>
            <li>Chat edits create reviewable plans</li>
          </ol>
        </div>
      </aside>
    </div>
  );
}

function GeneratingScreen({ prompt, progress }: { prompt: string; progress: number }) {
  const activeIndex = Math.min(progressSteps.length - 1, Math.floor(progress / 22));

  return (
    <div className="kv-generating">
      <div className="kv-render-orbit">
        <Film size={44} />
        <span />
      </div>
      <div className="kv-section-heading centered">
        <span className="kv-pill">Generating</span>
        <h2>Building your video plan with the AI engine</h2>
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

function PreviewCanvas({
  scene,
  isBusy,
  isPlaying,
  elapsedSeconds,
  totalSeconds,
  onTogglePlayback
}: {
  scene?: Scene;
  isBusy: boolean;
  isPlaying: boolean;
  elapsedSeconds: number;
  totalSeconds: number;
  onTogglePlayback: () => void;
}) {
  const light = scene?.style.theme.toLowerCase().includes("light");
  const progress = totalSeconds > 0 ? Math.min(100, (elapsedSeconds / totalSeconds) * 100) : 0;
  const visual = compactText(scene?.visualPrompt, "Scene visual will appear here.", 110);
  const motion = compactText(scene?.motionPrompt, "Camera and animation direction will appear here.", 96);
  const voice = compactText(scene?.voiceover, "Narration will appear here.", 88);

  return (
    <section className={`kv-preview ${light ? "light" : ""}`}>
      <div className="kv-preview-meta">
        <span>Scene {scene?.sceneNumber ?? 1}</span>
        <strong>{scene?.title ?? "No scene selected"}</strong>
      </div>
      <div className="kv-preview-grid">
        <div className="kv-preview-card wide">
          <small>画面重点</small>
          <span>{visual}</span>
        </div>
        <div className="kv-preview-card">
          <small>镜头运动</small>
          <span>{motion}</span>
        </div>
        <div className="kv-preview-card">
          <small>旁白意图</small>
          <span>{voice}</span>
        </div>
      </div>
      <div className="kv-scene-composition" aria-hidden="true">
        <div className="kv-composition-main">
          <span>{scene?.title ?? "Scene"}</span>
        </div>
        <div className="kv-composition-stack">
          <i />
          <i />
          <i />
        </div>
      </div>
      <button className={`kv-play ${isPlaying ? "playing" : ""}`} onClick={onTogglePlayback} type="button">
        {isBusy ? <Loader2 className="kv-spin" size={28} /> : isPlaying ? <span className="kv-pause-icon" /> : <Play fill="currentColor" size={30} />}
      </button>
      <p className="kv-caption">{isBusy ? "Updating video plan..." : scene?.voiceover ?? "Generate a video to preview scenes."}</p>
      <div className="kv-player-bar">
        <span>{durationLabel(Math.floor(elapsedSeconds))}</span>
        <div>
          <i style={{ width: `${progress}%` }} />
        </div>
        <span>{durationLabel(totalSeconds)}</span>
      </div>
    </section>
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
        <h3>Storyboard</h3>
        <span>{scenes.length} scenes</span>
      </div>
      <div className="kv-scene-strip">
        {scenes.map((scene) => (
          <button
            className={scene.sceneNumber === selectedScene ? "active" : ""}
            key={scene.id}
            onClick={() => onSelect(scene.sceneNumber)}
            type="button"
          >
            <span>S{scene.sceneNumber}</span>
            <strong>{scene.title}</strong>
            <small>{scene.durationSeconds}s</small>
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
        <h3>Scene direction</h3>
        <span>{scene?.style.theme ?? "theme"}</span>
      </div>
      <div className="kv-scene-grid">
        <article>
          <span>Voiceover</span>
          <p>{scene?.voiceover ?? "No voiceover yet."}</p>
        </article>
        <article>
          <span>Visual prompt</span>
          <p>{scene?.visualPrompt ?? "No visual prompt yet."}</p>
        </article>
        <article>
          <span>Motion prompt</span>
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
        <strong>Scene {change.sceneNumber}</strong>
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
          <span className="kv-eyebrow">Conversational editing</span>
          <h3>Adjust the video</h3>
        </div>
        <PanelRightOpen size={20} />
      </header>
      <div className="kv-chat-log">
        {messages.map((message) => (
          <div className={`kv-msg ${message.role}`} key={message.id}>
            <p>{message.content}</p>
            {message.editPlan ? (
              <div className="kv-plan-summary">
                <span>Affected: {message.editPlan.affectedScenes.join(", ")}</span>
                <span>Regenerate: {uniqueRegenerate(message.editPlan)}</span>
              </div>
            ) : null}
          </div>
        ))}
        {pendingPlan ? (
          <section className="kv-review-plan">
            <div className="kv-strip-heading">
              <h3>Review edit plan</h3>
              <span>{pendingPlan.changes.length} changes</span>
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
  isPlaying,
  elapsedSeconds,
  isBusy,
  onInput,
  onSubmit,
  onApply,
  onCancel,
  onSelectScene,
  onViewChange,
  onTogglePlayback,
  onUpload
}: {
  project: Project;
  messages: ChatMessage[];
  pendingPlan?: EditPlan;
  input: string;
  selectedScene: number;
  view: StudioView;
  isPlaying: boolean;
  elapsedSeconds: number;
  isBusy: boolean;
  onInput: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onApply: () => void;
  onCancel: () => void;
  onSelectScene: (scene: number) => void;
  onViewChange: (view: StudioView) => void;
  onTogglePlayback: () => void;
  onUpload: () => void;
}) {
  const scene = project.currentVersion.scenes.find((item) => item.sceneNumber === selectedScene) ?? project.currentVersion.scenes[0];

  return (
    <div className="kv-studio">
      <section className="kv-studio-main">
        <div className="kv-actionbar">
          <div className="kv-tabs">
            <button className={view === "preview" ? "active" : ""} onClick={() => onViewChange("preview")} type="button">
              <Film size={16} />
              Preview
            </button>
            <button className={view === "storyboard" ? "active" : ""} onClick={() => onViewChange("storyboard")} type="button">
              <Layers3 size={16} />
              Storyboard
            </button>
          </div>
          <div className="kv-actions">
            <button onClick={onUpload} type="button">
              <ImagePlus size={16} />
              素材
            </button>
            <button type="button">
              <RefreshCcw size={16} />
              重新渲染
            </button>
            <button className="kv-primary" type="button">
              <Download size={16} />
              导出
            </button>
          </div>
        </div>
        {view === "preview" ? (
          <>
            <PreviewCanvas
              elapsedSeconds={elapsedSeconds}
              isBusy={isBusy}
              isPlaying={isPlaying}
              onTogglePlayback={onTogglePlayback}
              scene={scene}
              totalSeconds={project.currentVersion.durationSeconds}
            />
            <Storyboard onSelect={onSelectScene} scenes={project.currentVersion.scenes} selectedScene={selectedScene} />
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
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [studioView, setStudioView] = useState<StudioView>("preview");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const generationPrompt = useMemo(() => briefPrompt.trim(), [briefPrompt]);

  function pushMessage(message: Omit<ChatMessage, "id">) {
    setMessages((current) => [...current, { ...message, id: crypto.randomUUID() }]);
  }

  useEffect(() => {
    if (!isPlaying || stage !== "studio") return undefined;

    const timer = window.setInterval(() => {
      setElapsedSeconds((current) => {
        const next = current + 0.25;
        if (next >= project.currentVersion.durationSeconds) {
          window.clearInterval(timer);
          setIsPlaying(false);
          return project.currentVersion.durationSeconds;
        }

        setSelectedScene(sceneAtTime(project.currentVersion.scenes, next));
        return next;
      });
    }, 250);

    return () => window.clearInterval(timer);
  }, [isPlaying, project.currentVersion.durationSeconds, project.currentVersion.scenes, stage]);

  function togglePlayback() {
    if (project.currentVersion.scenes.length === 0) return;

    setIsPlaying((current) => {
      if (!current && elapsedSeconds >= project.currentVersion.durationSeconds) {
        setElapsedSeconds(0);
        setSelectedScene(1);
      }

      return !current;
    });
  }

  async function createVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = generationPrompt;
    if (!prompt) return;

    setIsBusy(true);
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
      if (!response.ok) throw new Error("Failed to create project.");
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
      setSelectedScene(1);
      setElapsedSeconds(0);
      setIsPlaying(false);
      setPendingPlan(undefined);
      setStudioView("preview");
      setProgress(100);
      window.setTimeout(() => setStage("studio"), 350);
    } catch (error) {
      console.error(error);
      setStage("brief");
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
      setElapsedSeconds(0);
      setIsPlaying(false);
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

  function resetToBrief() {
    setStage("brief");
    setPendingPlan(undefined);
    setChatInput("");
    setIsPlaying(false);
    setElapsedSeconds(0);
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
        />
      ) : null}
      {stage === "generating" ? (
        <GeneratingScreen progress={progress} prompt={generationPrompt} />
      ) : null}
      {stage === "studio" ? (
        <StudioScreen
          input={chatInput}
          elapsedSeconds={elapsedSeconds}
          isBusy={isBusy}
          isPlaying={isPlaying}
          messages={messages}
          onApply={applyPlan}
          onCancel={() => setPendingPlan(undefined)}
          onInput={setChatInput}
          onSelectScene={setSelectedScene}
          onSubmit={submitChat}
          onTogglePlayback={togglePlayback}
          onUpload={() => fileInputRef.current?.click()}
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
