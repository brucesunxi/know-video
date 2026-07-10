"use client";

import { ChangeEvent, FormEvent, useMemo, useRef, useState } from "react";
import {
  Bell,
  Box,
  ChevronDown,
  Clock3,
  Download,
  Film,
  Gift,
  Grid2X2,
  Image,
  MessageCirclePlus,
  Mic,
  Moon,
  Music2,
  Play,
  Plus,
  RotateCcw,
  Search,
  Share2,
  Sparkles,
  Subtitles,
  Upload,
  User,
  WandSparkles,
  Zap
} from "lucide-react";
import { pipelineSteps } from "@/lib/architecture";
import type { ChatMessage, EditChange, EditPlan, Project, Scene } from "@/lib/types";

type Source = "database" | "mock";

function Sidebar() {
  return (
    <aside className="sidebar" aria-label="Workspace navigation">
      <div className="brand-mark">K</div>
      <nav className="side-nav">
        <button aria-label="Account">
          <User size={18} />
        </button>
        <button className="active" aria-label="New conversation">
          <MessageCirclePlus size={20} />
        </button>
        <button aria-label="Search">
          <Search size={20} />
        </button>
        <button aria-label="Projects">
          <Grid2X2 size={20} />
        </button>
      </nav>
      <div className="side-footer">
        <button aria-label="Help">?</button>
        <button aria-label="Billing">
          <Box size={18} />
        </button>
      </div>
    </aside>
  );
}

function TopBar({ project, source }: { project: Project; source: Source }) {
  return (
    <header className="topbar">
      <div className="engine-picker">
        <Zap size={18} />
        <span>{project.engine}</span>
        <ChevronDown size={16} />
      </div>
      <h1>{project.title}</h1>
      <div className="topbar-actions">
        <div className={`source-pill ${source}`}>{source === "database" ? "Neon" : "Local state"}</div>
        <div className="credits">
          {project.plan} · {project.credits} credits · <span>Get more</span>
        </div>
        <button aria-label="Theme">
          <Moon size={22} />
        </button>
        <button className="notification" aria-label="Notifications">
          <Bell size={22} />
          <span>2</span>
        </button>
        <button aria-label="Rewards">
          <Gift size={22} />
        </button>
        <div className="slack-dot" aria-label="Slack integration" />
        <div className="avatar">S</div>
      </div>
    </header>
  );
}

function VideoPreview({
  scene,
  durationSeconds,
  isRendering
}: {
  scene?: Scene;
  durationSeconds: number;
  isRendering: boolean;
}) {
  const isLight = scene?.style.theme.includes("light");

  return (
    <section className="video-shell" aria-label="Video preview">
      <div className="preview-toolbar">
        <div className="view-switch">
          <button className="selected">
            <Film size={14} />
            Video
          </button>
          <button>
            <Grid2X2 size={14} />
            Storyboard
          </button>
        </div>
        <div className="preview-actions">
          <button className="dark">
            <Share2 size={15} />
            Share
          </button>
          <button>
            <Sparkles size={15} />
            Render plan
          </button>
          <button>
            <Download size={15} />
            Export
          </button>
        </div>
      </div>
      <div className="player-card">
        <div className={`player-frame ${isLight ? "light-scene" : ""}`}>
          <div className="scene-title-overlay">{scene?.title ?? "Create a video to begin"}</div>
          <button className="play-button" aria-label="Play video">
            <Play size={30} fill="currentColor" />
          </button>
          <div className="watermark">interactive storyboard</div>
          <div className="caption">
            {isRendering ? "Applying scene changes and preparing render tasks..." : scene?.voiceover ?? "Describe a video in the editor to generate scenes."}
          </div>
          <div className="player-controls">
            <Play size={22} fill="currentColor" />
            <span className="volume" />
            <span>0:00 / 0:{String(durationSeconds).padStart(2, "0")}</span>
          </div>
          <div className="fullscreen">□</div>
        </div>
      </div>
    </section>
  );
}

function SceneTimeline({
  scenes,
  selectedScene,
  onSelectScene
}: {
  scenes: Scene[];
  selectedScene: number;
  onSelectScene: (sceneNumber: number) => void;
}) {
  return (
    <section className="timeline" aria-label="Scene timeline">
      {scenes.map((scene) => {
        const isLight = scene.style.theme.includes("light");
        return (
          <div className="timeline-item" key={scene.id}>
            <button
              className={`scene-thumb ${selectedScene === scene.sceneNumber ? "selected" : ""} ${isLight ? "light" : ""}`}
              onClick={() => onSelectScene(scene.sceneNumber)}
              type="button"
            >
              <div className="mini-grid" />
              <span>S{scene.sceneNumber}</span>
              <strong>{scene.title}</strong>
            </button>
            {scene.sceneNumber < scenes.length ? (
              <button className="insert-scene" aria-label="Insert scene">
                <Plus size={12} />
              </button>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

function ToolDock({ onUploadClick }: { onUploadClick: () => void }) {
  const tools = [
    { label: "Add music", icon: Music2 },
    { label: "Add logo", icon: Image },
    { label: "Upload media", icon: Upload },
    { label: "Captions", icon: Subtitles, active: true },
    { label: "Add interaction", icon: WandSparkles },
    { label: "Change voice", icon: Mic },
    { label: "Speed", icon: Clock3 }
  ];

  return (
    <section className="tool-dock" aria-label="Video tools">
      {tools.map((tool) => {
        const Icon = tool.icon;
        return (
          <button
            className={tool.active ? "active" : ""}
            key={tool.label}
            onClick={tool.label === "Upload media" ? onUploadClick : undefined}
            type="button"
          >
            <Icon size={22} />
            <span>{tool.label}</span>
          </button>
        );
      })}
    </section>
  );
}

function SceneInspector({ scene }: { scene?: Scene }) {
  return (
    <section className="scene-inspector">
      <div>
        <span className="eyebrow">Selected scene</span>
        <h2>{scene?.title ?? "No scene selected"}</h2>
      </div>
      <div className="scene-fields">
        <div>
          <strong>Voiceover</strong>
          <p>{scene?.voiceover ?? "Generate a video first."}</p>
        </div>
        <div>
          <strong>Visual prompt</strong>
          <p>{scene?.visualPrompt ?? "Scene visual prompt will appear here."}</p>
        </div>
        <div>
          <strong>Motion</strong>
          <p>{scene?.motionPrompt ?? "Motion prompt will appear here."}</p>
        </div>
      </div>
    </section>
  );
}

function ChangeCard({ change }: { change: EditChange }) {
  return (
    <article className="change-card">
      <div className="change-title">
        <strong>Scene {change.sceneNumber}</strong>
        <span>{change.status}</span>
      </div>
      <div className="before-after">
        <div>
          <small>Before</small>
          <div className={`diff-preview ${change.before.thumbnailTone}`}>
            <span>{change.before.title}</span>
          </div>
        </div>
        <div className="arrow">→</div>
        <div>
          <small>After</small>
          <div className={`diff-preview ${change.after.thumbnailTone}`}>
            <span>{change.after.title}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

function ArchitecturePanel() {
  return (
    <section className="architecture-panel">
      <div>
        <span className="eyebrow">Build plan</span>
        <h2>Conversational video engineering loop</h2>
      </div>
      <ol>
        {pipelineSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </section>
  );
}

function EditorPanel({
  messages,
  pendingPlan,
  input,
  isBusy,
  onInput,
  onSubmit,
  onApplyPlan,
  onCancelPlan
}: {
  messages: ChatMessage[];
  pendingPlan?: EditPlan;
  input: string;
  isBusy: boolean;
  onInput: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onApplyPlan: () => void;
  onCancelPlan: () => void;
}) {
  return (
    <aside className="editor">
      <div className="editor-header">Editor</div>
      <div className="chat-stream">
        <div className="reply-context">
          <RotateCcw size={17} />
          <div>
            <strong>Live planning mode</strong>
            <p>Describe a new video, or ask for scene-level edits such as “make scene 2 lighter”.</p>
          </div>
        </div>
        {messages.map((message) => {
          if (message.type === "version") {
            return (
              <div className="version-pill" key={message.id}>
                <ChevronDown size={16} />
                <span>{message.content}</span>
                <button>Restore</button>
              </div>
            );
          }

          if (message.role === "user") {
            return (
              <div className="message user-message" key={message.id}>
                <p>{message.content}</p>
                <div className="avatar small">S</div>
              </div>
            );
          }

          return (
            <div className="message assistant-message" key={message.id}>
              <div className="assistant-avatar">K</div>
              <div className="plan-card">
                <p>{message.content}</p>
                {message.editPlan ? (
                  <ul>
                    <li><strong>Affected scenes:</strong> {message.editPlan.affectedScenes.join(", ")}</li>
                    <li><strong>Regenerate:</strong> {Array.from(new Set(message.editPlan.changes.flatMap((change) => change.regenerate))).join(", ")}</li>
                    <li><strong>Status:</strong> waiting for your confirmation</li>
                  </ul>
                ) : null}
              </div>
            </div>
          );
        })}
        {pendingPlan ? (
          <div className="diff-stack">
            {pendingPlan.changes.map((change) => (
              <ChangeCard change={change} key={change.sceneNumber} />
            ))}
            <p className="confirm-copy">Apply this plan and create a new editable version?</p>
            <div className="confirm-actions">
              <button className="primary" onClick={onApplyPlan} type="button">Yes, apply</button>
              <button onClick={onCancelPlan} type="button">No, cancel</button>
            </div>
          </div>
        ) : null}
      </div>
      <form className="chat-input" onSubmit={onSubmit}>
        <textarea
          disabled={isBusy}
          onChange={(event) => onInput(event.target.value)}
          placeholder="Create a product video about... / Make scene 3 more cinematic..."
          value={input}
        />
        <div className="input-actions">
          <button type="button">
            <Image size={20} />
          </button>
          <button type="button">@</button>
          <button type="button">
            <Mic size={20} />
          </button>
          <button className="send" disabled={isBusy || input.trim().length === 0} type="submit">
            ↑
          </button>
        </div>
      </form>
    </aside>
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
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: crypto.randomUUID(),
      role: "assistant",
      type: "text",
      content: "Tell me what video you want to create. I will break it into scenes, then you can refine any scene through chat."
    },
    ...initialMessages
  ]);
  const [input, setInput] = useState("");
  const [selectedScene, setSelectedScene] = useState(1);
  const [pendingPlan, setPendingPlan] = useState<EditPlan | undefined>();
  const [isBusy, setIsBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentScene = useMemo(
    () => project.currentVersion.scenes.find((scene) => scene.sceneNumber === selectedScene) ?? project.currentVersion.scenes[0],
    [project.currentVersion.scenes, selectedScene]
  );

  function pushMessage(message: Omit<ChatMessage, "id">) {
    setMessages((current) => [...current, { ...message, id: crypto.randomUUID() }]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = input.trim();
    if (!request) return;

    setIsBusy(true);
    setInput("");
    pushMessage({ role: "user", type: "text", content: request });

    try {
      const createIntent = /create|generate|make|做|生成|创建|制作/i.test(request)
        && !/scene|第\d|修改|adjust|change|edit|改/i.test(request);

      if (createIntent) {
        const response = await fetch("/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: request })
        });
        if (!response.ok) throw new Error("Failed to create project.");
        const data = await response.json() as {
          project: Project;
          messages: ChatMessage[];
          engine: "deepseek-flash" | "openai" | "heuristic";
        };
        setProject(data.project);
        setMessages([
          ...data.messages,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            type: "text",
            content: data.engine === "openai"
              ? "This storyboard was generated by OpenAI and saved to Neon."
              : data.engine === "deepseek-flash"
                ? "This storyboard was generated by DeepSeek flash and saved to Neon."
                : "This storyboard was generated by the local planning engine and saved to Neon. Configure DeepSeek flash or OpenAI to switch to model generation."
          }
        ]);
        setSelectedScene(1);
        setPendingPlan(undefined);
      } else {
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
      }
    } catch (error) {
      console.error(error);
      pushMessage({
        role: "assistant",
        type: "text",
        content: "I could not complete that request. Check the server logs or environment variables, then try again."
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleApplyPlan() {
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
        renderJobId?: string;
      };
      setProject(data.project);
      setPendingPlan(undefined);
      setMessages((current) => [...current, data.message]);
    } catch (error) {
      console.error(error);
      pushMessage({
        role: "assistant",
        type: "text",
        content: "I could not apply that plan. Please try again after checking the deployment logs."
      });
    } finally {
      setIsBusy(false);
    }
  }

  function handleCancelPlan() {
    setPendingPlan(undefined);
    pushMessage({
      role: "assistant",
      type: "text",
      content: "Plan canceled. Send another instruction and I will create a new scene-level plan."
    });
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
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
      if (!response.ok) throw new Error("Failed to upload asset.");
      const data = await response.json() as { asset: { r2Key: string; metadata?: { name?: string } } };
      pushMessage({
        role: "assistant",
        type: "text",
        content: `Uploaded ${data.asset.metadata?.name ?? "asset"} to R2 at ${data.asset.r2Key}.`
      });
    } catch (error) {
      console.error(error);
      pushMessage({
        role: "assistant",
        type: "text",
        content: "Upload failed. Check R2 environment variables and bucket permissions."
      });
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <main className="app-frame">
      <Sidebar />
      <div className="workspace">
        <TopBar project={project} source={source} />
        <div className="content-grid">
          <div className="studio">
            <input
              hidden
              onChange={handleUpload}
              ref={fileInputRef}
              type="file"
            />
            <VideoPreview
              durationSeconds={project.currentVersion.durationSeconds}
              isRendering={isBusy}
              scene={currentScene}
            />
            <SceneTimeline
              onSelectScene={setSelectedScene}
              scenes={project.currentVersion.scenes}
              selectedScene={selectedScene}
            />
            <ToolDock onUploadClick={() => fileInputRef.current?.click()} />
            <SceneInspector scene={currentScene} />
            <ArchitecturePanel />
          </div>
          <EditorPanel
            input={input}
            isBusy={isBusy}
            messages={messages}
            onApplyPlan={handleApplyPlan}
            onCancelPlan={handleCancelPlan}
            onInput={setInput}
            onSubmit={handleSubmit}
            pendingPlan={pendingPlan}
          />
        </div>
      </div>
    </main>
  );
}
