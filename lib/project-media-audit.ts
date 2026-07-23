import { resolvedClipPlaybackRate } from "@/lib/clip-timing";
import { narrationComfortIssue } from "@/lib/narration-fit";
import { productionSettingsFromScenes } from "@/lib/production-settings";
import type { Project, Scene, SceneAsset } from "@/lib/types";

export type ProjectMediaAuditIssue = {
  code:
    | "missing-visual"
    | "missing-audio"
    | "source-not-bound"
    | "legacy-chinese-voice"
    | "voice-mismatch"
    | "audio-overrun"
    | "audio-silent-tail"
    | "audio-duration-unknown"
    | "narration-crowded"
    | "clip-duration-unknown"
    | "clip-freeze-tail";
  sceneNumber: number;
  media: "visual" | "audio" | "clip";
  severity: "error" | "warning";
  message: string;
};

function durationMetadata(asset: SceneAsset) {
  const value = Number(asset.metadata?.duration ?? asset.metadata?.actualDurationSeconds);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function isChinese(text: string) {
  return /\p{Script=Han}/u.test(text);
}

function sourceBindingIssues(scene: Scene): ProjectMediaAuditIssue[] {
  return (scene.style.referenceAssets ?? []).flatMap((reference) => {
    if (reference.referenceUsage !== "source-media") return [];
    const expectedMedia = reference.contentType.startsWith("audio/") ? "audio" as const : "visual" as const;
    const bound = scene.assets.some((asset) =>
      asset.r2Key === reference.key
      && (expectedMedia === "audio" ? asset.type === "audio" : ["image", "clip"].includes(asset.type))
    );
    return bound ? [] : [{
      code: "source-not-bound" as const,
      sceneNumber: scene.sceneNumber,
      media: expectedMedia,
      severity: "error" as const,
      message: `场景 ${scene.sceneNumber} 标记为直接采用的附件没有进入成片轨道。`
    }];
  });
}

export function auditProjectMedia(project: Project) {
  const issues: ProjectMediaAuditIssue[] = [];
  const production = productionSettingsFromScenes(project.currentVersion.scenes);

  for (const scene of project.currentVersion.scenes) {
    const visual = scene.assets.find((asset) => ["clip", "image"].includes(asset.type) && asset.url);
    const audio = scene.assets.find((asset) => asset.type === "audio" && asset.url);
    const clip = scene.assets.find((asset) => asset.type === "clip" && asset.url);
    if (!visual) {
      issues.push({ code: "missing-visual", sceneNumber: scene.sceneNumber, media: "visual", severity: "error", message: `场景 ${scene.sceneNumber} 缺少画面。` });
    }
    if (!audio) {
      issues.push({ code: "missing-audio", sceneNumber: scene.sceneNumber, media: "audio", severity: "error", message: `场景 ${scene.sceneNumber} 缺少配音。` });
    }
    issues.push(...sourceBindingIssues(scene));

    if (audio) {
      const actualDuration = durationMetadata(audio);
      const model = String(audio.metadata?.model ?? "");
      const actualVoice = typeof audio.metadata?.narrationVoice === "string" ? audio.metadata.narrationVoice : undefined;
      if (isChinese(scene.voiceover) && /melotts/i.test(model)) {
        issues.push({ code: "legacy-chinese-voice", sceneNumber: scene.sceneNumber, media: "audio", severity: "error", message: `场景 ${scene.sceneNumber} 仍在使用旧中文音轨，需要重新配音。` });
      }
      if (scene.style.narrationVoice && actualVoice && actualVoice !== scene.style.narrationVoice) {
        issues.push({ code: "voice-mismatch", sceneNumber: scene.sceneNumber, media: "audio", severity: "error", message: `场景 ${scene.sceneNumber} 的实际音色与当前选择不一致。` });
      }
      if (!actualDuration && audio.metadata?.source === "ai-speech") {
        issues.push({ code: "audio-duration-unknown", sceneNumber: scene.sceneNumber, media: "audio", severity: "warning", message: `场景 ${scene.sceneNumber} 的配音缺少时长质检信息。` });
      }
      const trailingSilence = Number(audio.metadata?.trailingSilenceSeconds);
      if (
        Number.isFinite(trailingSilence)
        && trailingSilence > Math.max(1.2, (actualDuration ?? scene.durationSeconds) * 0.45)
      ) {
        issues.push({ code: "audio-silent-tail", sceneNumber: scene.sceneNumber, media: "audio", severity: "error", message: `场景 ${scene.sceneNumber} 的配音后半段异常静音，需要重新生成。` });
      }
    }

    if (narrationComfortIssue(scene.voiceover, scene.durationSeconds) === "too-long") {
      issues.push({ code: "narration-crowded", sceneNumber: scene.sceneNumber, media: "audio", severity: "warning", message: `场景 ${scene.sceneNumber} 的旁白较密，成片语速可能偏快。` });
    }

    if (clip) {
      const duration = durationMetadata(clip);
      if (!duration) {
        issues.push({ code: "clip-duration-unknown", sceneNumber: scene.sceneNumber, media: "clip", severity: "warning", message: `场景 ${scene.sceneNumber} 的视频片段缺少时长信息。` });
      } else {
        const rate = resolvedClipPlaybackRate({
          asset: clip,
          sceneDurationSeconds: scene.durationSeconds,
          productionPlaybackRate: production.playbackRate
        });
        const contentSeconds = scene.durationSeconds / production.playbackRate;
        const playedSeconds = duration / rate;
        const frozenTail = contentSeconds - playedSeconds;
        if (frozenTail > 0.35) {
          issues.push({ code: "clip-freeze-tail", sceneNumber: scene.sceneNumber, media: "clip", severity: "error", message: `场景 ${scene.sceneNumber} 的视频会在结尾停帧约 ${frozenTail.toFixed(1)} 秒。` });
        }
      }
    }
  }

  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const uniqueScenes = (media: ProjectMediaAuditIssue["media"], source = errors) => Array.from(new Set(
    source.filter((issue) => issue.media === media).map((issue) => issue.sceneNumber)
  )).sort((left, right) => left - right);
  return {
    ready: project.currentVersion.scenes.length > 0 && errors.length === 0,
    issues,
    errors,
    warnings,
    repairVisualSceneNumbers: uniqueScenes("visual"),
    repairAudioSceneNumbers: uniqueScenes("audio"),
    repairClipSceneNumbers: uniqueScenes("clip")
  };
}
