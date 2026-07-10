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
import { lightThemeEditPlan } from "@/lib/mock-data";
import { pipelineSteps } from "@/lib/architecture";
import { getCurrentProjectSnapshot } from "@/lib/project-store";
import type { ChatMessage, EditChange, EditPlan, Project, Scene } from "@/lib/types";

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

function TopBar({ project, source }: { project: Project; source: "database" | "mock" }) {
  return (
    <header className="topbar">
      <div className="engine-picker">
        <Zap size={18} />
        <span>{project.engine}</span>
        <ChevronDown size={16} />
      </div>
      <h1>{project.title}</h1>
      <div className="topbar-actions">
        <div className={`source-pill ${source}`}>{source === "database" ? "Neon" : "Mock"}</div>
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

function VideoPreview({ firstScene, durationSeconds }: { firstScene?: Scene; durationSeconds: number }) {
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
            Remove watermark
          </button>
          <button>
            <Download size={15} />
            Export
          </button>
        </div>
      </div>
      <div className="player-card">
        <div className="player-frame">
          <button className="play-button" aria-label="Play video">
            <Play size={30} fill="currentColor" />
          </button>
          <div className="watermark">powered by <strong>K</strong> nowlify</div>
          <div className="caption">
            {firstScene?.voiceover ?? "Your video voiceover will appear here."}
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

function SceneTimeline({ scenes }: { scenes: Scene[] }) {
  return (
    <section className="timeline" aria-label="Scene timeline">
      {scenes.map((scene) => (
        <div className="timeline-item" key={scene.id}>
          <div className="scene-thumb">
            <div className="mini-grid" />
            <span>S{scene.sceneNumber}</span>
          </div>
          {scene.sceneNumber < scenes.length ? <button className="insert-scene" aria-label="Insert scene"><Plus size={12} /></button> : null}
        </div>
      ))}
    </section>
  );
}

function ToolDock() {
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
          <button className={tool.active ? "active" : ""} key={tool.label}>
            <Icon size={22} />
            <span>{tool.label}</span>
          </button>
        );
      })}
    </section>
  );
}

function VoiceoverPanel({ firstScene }: { firstScene?: Scene }) {
  return (
    <section className="voiceover">
      <div>
        <span className="eyebrow">Voiceover</span>
        <p>{firstScene?.voiceover ?? "Select a scene to edit its voiceover."}</p>
      </div>
      <button>Edit</button>
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

function EditorPanel({ messages, editPlan }: { messages: ChatMessage[]; editPlan: EditPlan }) {
  const visibleChanges = editPlan.changes.slice(-2);

  return (
    <aside className="editor">
      <div className="editor-header">Editor</div>
      <div className="chat-stream">
        <div className="reply-context">
          <RotateCcw size={17} />
          <div>
            <strong>Replying to plan</strong>
            <p>Here is the plan to revert the entire video back to the original premium dark theme...</p>
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
                <ul>
                  <li><strong>Affected scenes:</strong> {(message.editPlan ?? editPlan).affectedScenes.join(", ")}</li>
                  <li><strong>Regenerate:</strong> scene images, clips, thumbnails, final render</li>
                  <li><strong>Keep:</strong> timing, narration, captions, project structure</li>
                </ul>
              </div>
            </div>
          );
        })}
        <div className="diff-stack">
          {visibleChanges.map((change) => (
            <ChangeCard change={change} key={change.sceneNumber} />
          ))}
          <p className="confirm-copy">Go ahead with adjusting the entire video to this premium light theme?</p>
          <div className="confirm-actions">
            <button className="primary">Yes, go ahead</button>
            <button>No, cancel</button>
          </div>
        </div>
      </div>
      <form className="chat-input">
        <textarea placeholder="Edit the plan" />
        <div className="input-actions">
          <button type="button">
            <Image size={20} />
          </button>
          <button type="button">@</button>
          <button type="button">
            <Mic size={20} />
          </button>
          <button type="button" className="send">
            ↑
          </button>
        </div>
      </form>
    </aside>
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

export default async function Home() {
  const { project, messages, source } = await getCurrentProjectSnapshot();
  const firstScene = project.currentVersion.scenes[0];

  return (
    <main className="app-frame">
      <Sidebar />
      <div className="workspace">
        <TopBar project={project} source={source} />
        <div className="content-grid">
          <div className="studio">
            <VideoPreview firstScene={firstScene} durationSeconds={project.currentVersion.durationSeconds} />
            <SceneTimeline scenes={project.currentVersion.scenes} />
            <ToolDock />
            <VoiceoverPanel firstScene={firstScene} />
            <ArchitecturePanel />
          </div>
          <EditorPanel messages={messages} editPlan={lightThemeEditPlan} />
        </div>
      </div>
    </main>
  );
}
