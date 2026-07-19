import React from "react";
import {
  AbsoluteFill,
  Audio,
  Freeze,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame
} from "remotion";
import type { Project, Scene } from "@/lib/types";
import { musicMixEnvelope, type NarrationFrameRange } from "@/lib/audio-mix";
import { clipDurationInFrames, resolvedClipPlaybackRate } from "@/lib/clip-timing";
import { readableTextColor, sceneAccentColor } from "@/lib/color-contrast";
import { activeNarrationCaption, narrationAudioPlaybackRate, narrationDurationInFrames } from "@/lib/narration-timing";
import { productionAsset, productionSettings } from "@/lib/production-settings";
import { boundedTransitionFrames, resolvedSceneTransition, type ResolvedSceneTransitionKind } from "@/lib/scene-transitions";
import { VIDEO_FPS } from "@/video/config";

export type KnowVideoCompositionProps = { project: Project };

function hasCjk(text: string) {
  return /\p{Script=Han}/u.test(text);
}

function titleFontSize(title: string) {
  const weightedLength = Array.from(title).reduce((sum, character) => sum + (hasCjk(character) ? 1.75 : 1), 0);
  if (weightedLength > 46) return 46;
  if (weightedLength > 34) return 54;
  if (weightedLength > 24) return 61;
  return 68;
}

function captionFontSize(caption: string) {
  const weightedLength = Array.from(caption).reduce((sum, character) => sum + (hasCjk(character) ? 1.7 : 1), 0);
  if (weightedLength > 48) return 25;
  if (weightedLength > 36) return 28;
  return 31;
}

function motionValues(scene: Scene, frame: number, durationInFrames: number) {
  const progressRange = [0, Math.max(1, durationInFrames - 1)];
  const direction = scene.motionPrompt.toLowerCase();
  const pansRight = direction.includes("right") || direction.includes("向右");
  const pansLeft = direction.includes("left") || direction.includes("向左");
  const movesUp = direction.includes("upward") || direction.includes("rise") || direction.includes("向上") || direction.includes("上升");
  const movesDown = direction.includes("downward") || direction.includes("descend") || direction.includes("向下") || direction.includes("下降");
  const orbit = direction.includes("orbit") || direction.includes("arc") || direction.includes("环绕") || direction.includes("弧线");
  const pullsBack = direction.includes("pull") || direction.includes("zoom out") || direction.includes("拉远");
  const x = pansRight
    ? interpolate(frame, progressRange, [-3.2, 3.2])
    : pansLeft
      ? interpolate(frame, progressRange, [3.2, -3.2])
      : orbit
        ? interpolate(frame, progressRange, [scene.sceneNumber % 2 === 0 ? 2.4 : -2.4, scene.sceneNumber % 2 === 0 ? -2.4 : 2.4])
        : interpolate(frame, progressRange, [0, scene.sceneNumber % 2 === 0 ? -1.6 : 1.6]);
  const y = movesUp
    ? interpolate(frame, progressRange, [2.4, -2.4])
    : movesDown
      ? interpolate(frame, progressRange, [-2.4, 2.4])
      : orbit
        ? interpolate(frame, progressRange, [-1.2, 1.2])
        : 0;
  const scale = pullsBack
    ? interpolate(frame, progressRange, [1.14, 1.035])
    : interpolate(frame, progressRange, [1.035, 1.115]);
  return { x, y, scale };
}

function visualLayerStyle({
  motion,
  nativeVideo
}: {
  motion: ReturnType<typeof motionValues>;
  nativeVideo: boolean;
}): React.CSSProperties {
  if (nativeVideo) {
    return {
      height: "100%",
      left: 0,
      objectFit: "cover",
      position: "absolute",
      top: 0,
      transform: "none",
      width: "100%"
    };
  }

  return {
    height: "106%",
    left: `${motion.x}%`,
    objectFit: "cover",
    position: "absolute",
    top: `${-3 + motion.y}%`,
    transform: `scale(${motion.scale})`,
    width: "106%"
  };
}

function transitionStyle(kind: ResolvedSceneTransitionKind, frame: number, transitionFrames: number, active: boolean) {
  if (!active || frame >= transitionFrames) return {};
  const progress = interpolate(frame, [0, transitionFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  if (kind === "push-left") return { transform: `translateX(${(1 - progress) * 8}%)` };
  if (kind === "push-right") return { transform: `translateX(${(progress - 1) * 8}%)` };
  if (kind === "zoom") return { transform: `scale(${1.055 - progress * 0.055})` };
  if (kind === "wipe") return { clipPath: `inset(0 ${Math.max(0, 100 - progress * 100)}% 0 0)` };
  return {};
}

function audioVolume(frame: number, durationInFrames: number) {
  const fadeFrames = Math.max(2, Math.min(Math.round(VIDEO_FPS * 0.16), Math.floor(durationInFrames / 4)));
  const fadeIn = interpolate(frame, [0, fadeFrames], [0, 0.96], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const fadeOut = interpolate(
    frame,
    [Math.max(fadeFrames, durationInFrames - fadeFrames), durationInFrames],
    [0.96, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  return Math.min(fadeIn, fadeOut);
}

function SceneFrame({
  scene,
  projectTitle,
  captionsEnabled,
  captionStyle,
  playbackRate,
  contentDurationInFrames,
  transitionInFrames,
  transitionOutFrames
}: {
  scene: Scene;
  projectTitle: string;
  captionsEnabled: boolean;
  captionStyle: "minimal" | "boxed" | "highlight";
  playbackRate: number;
  contentDurationInFrames: number;
  transitionInFrames: number;
  transitionOutFrames: number;
}) {
  const frame = useCurrentFrame();
  const entrance = spring({ frame, fps: VIDEO_FPS, config: { damping: 18, mass: 0.8 } });
  const hasTransitionIn = transitionInFrames > 0;
  const hasTransitionOut = transitionOutFrames > 0;
  const fadeIn = hasTransitionIn
    ? interpolate(frame, [0, transitionInFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 1;
  const fadeOut = hasTransitionOut
    ? interpolate(
      frame,
      [contentDurationInFrames, contentDurationInFrames + transitionOutFrames],
      [1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    )
    : 1;
  const fade = fadeIn * fadeOut;
  const copyFadeOut = hasTransitionOut
    ? interpolate(
      frame,
      [Math.max(0, contentDurationInFrames - transitionOutFrames), contentDurationInFrames],
      [1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    )
    : 1;
  const copyFadeIn = hasTransitionIn
    ? interpolate(
      frame,
      [Math.round(transitionInFrames * 0.45), transitionInFrames],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    )
    : 1;
  const copyOpacity = copyFadeIn * copyFadeOut;
  const visualFrame = Math.min(frame, contentDurationInFrames - 1);
  const motion = motionValues(scene, visualFrame, contentDurationInFrames);
  const titleHold = interpolate(
    visualFrame,
    [0, Math.round(contentDurationInFrames * 0.68), Math.round(contentDurationInFrames * 0.82)],
    [1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const transition = resolvedSceneTransition(scene).kind;
  const accent = sceneAccentColor(scene.style.palette);
  const accentText = readableTextColor(accent);
  const clipAsset = scene.assets.find((asset) => asset.type === "clip" && asset.url);
  const clip = clipAsset?.url;
  const clipPlaybackRate = clipAsset ? resolvedClipPlaybackRate({
    asset: clipAsset,
    sceneDurationSeconds: scene.durationSeconds,
    productionPlaybackRate: playbackRate
  }) : playbackRate;
  const declaredClipFrames = clipAsset
    ? clipDurationInFrames(clipAsset, VIDEO_FPS, clipPlaybackRate)
    : undefined;
  const lastClipFrame = declaredClipFrames
    ? Math.max(0, declaredClipFrames - 1)
    : Math.max(0, contentDurationInFrames - 1);
  const image = scene.assets.find((asset) => asset.type === "image" && asset.url)?.url;
  const audio = scene.assets.find((asset) => asset.type === "audio" && asset.url)?.url;
  const narrationPlaybackRate = narrationAudioPlaybackRate(scene, playbackRate, contentDurationInFrames, VIDEO_FPS);
  const narrationFrames = narrationDurationInFrames(scene, VIDEO_FPS, playbackRate, contentDurationInFrames);
  const caption = activeNarrationCaption(scene.voiceover, visualFrame, narrationFrames);
  const captionEntrance = caption ? interpolate(
    visualFrame,
    [caption.startFrame, Math.min(caption.endFrame, caption.startFrame + Math.round(VIDEO_FPS * 0.14))],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  ) : 0;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#08111f",
        opacity: fade,
        overflow: "hidden",
        ...transitionStyle(transition, frame, transitionInFrames, hasTransitionIn)
      }}
    >
      {clip ? (
        <Freeze active={(currentFrame) => currentFrame > lastClipFrame} frame={lastClipFrame}>
          <OffthreadVideo
            muted
            playbackRate={clipPlaybackRate}
            src={clip}
            style={visualLayerStyle({ motion, nativeVideo: true })}
          />
        </Freeze>
      ) : image ? (
        <Img
          src={image}
          style={visualLayerStyle({ motion, nativeVideo: false })}
        />
      ) : null}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(2,8,18,.16) 0%, rgba(2,8,18,.02) 42%, rgba(2,8,18,.9) 100%)" }} />
      <AbsoluteFill style={{ background: "linear-gradient(90deg, rgba(2,8,18,.5), transparent 62%)" }} />
      <AbsoluteFill style={{ boxShadow: "inset 0 0 180px rgba(0,0,0,.3)" }} />
      {hasTransitionIn && frame < transitionInFrames ? (
        <AbsoluteFill
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${accent}44 48%, transparent 100%)`,
            opacity: interpolate(frame, [0, transitionInFrames], [0.7, 0], { extrapolateRight: "clamp" }),
            transform: `translateX(${interpolate(frame, [0, transitionInFrames], [-35, 35])}%)`
          }}
        />
      ) : null}
      <div style={{ color: "rgba(255,255,255,.78)", fontFamily: "Arial, PingFang SC, Microsoft YaHei, sans-serif", fontSize: 23, fontWeight: 700, left: 74, opacity: copyOpacity, position: "absolute", top: 60 }}>
        KNOW VIDEO&nbsp;&nbsp;/&nbsp;&nbsp;{String(scene.sceneNumber).padStart(2, "0")}
      </div>
      <div
        style={{
          bottom: 214,
          color: "white",
          fontFamily: "Arial, PingFang SC, Microsoft YaHei, sans-serif",
          left: 74,
          maxWidth: 1320,
          opacity: entrance * copyOpacity * titleHold,
          position: "absolute",
          right: 74,
          transform: `translateY(${(1 - entrance) * 38}px)`
        }}
      >
        <div
          style={{
            display: "-webkit-box",
            fontSize: titleFontSize(scene.title),
            fontWeight: 800,
            letterSpacing: 0,
            lineHeight: 1.12,
            maxWidth: 1320,
            overflow: "hidden",
            textShadow: "0 4px 30px rgba(0,0,0,.42)",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2
          }}
        >
          {scene.title}
        </div>
      </div>
      {captionsEnabled && caption ? <div
        style={{
          bottom: 102,
          left: "50%",
          maxWidth: 1420,
          padding: captionStyle === "minimal" ? "5px 12px" : "13px 24px 15px",
          position: "absolute",
          borderRadius: captionStyle === "highlight" ? 2 : 8,
          background: captionStyle === "minimal" ? "transparent" : captionStyle === "highlight" ? accent : "rgba(2,8,18,.76)",
          color: captionStyle === "highlight" ? accentText : "#fff",
          fontFamily: "Arial, PingFang SC, Microsoft YaHei, sans-serif",
          fontSize: captionFontSize(caption.text),
          fontWeight: captionStyle === "highlight" ? 800 : 600,
          letterSpacing: 0,
          lineHeight: 1.35,
          overflowWrap: "anywhere",
          opacity: copyOpacity * captionEntrance,
          textAlign: "center",
          textShadow: captionStyle === "minimal" ? "0 2px 12px rgba(0,0,0,.9)" : "none",
          transform: `translate(-50%, ${(1 - captionEntrance) * 8}px)`
        }}
      >{caption.text}</div> : null}
      <div style={{ bottom: 52, color: "rgba(255,255,255,.7)", fontFamily: "Arial, PingFang SC, Microsoft YaHei, sans-serif", fontSize: 19, left: 74, opacity: copyOpacity, position: "absolute" }}>{projectTitle}</div>
      <div style={{ background: "rgba(255,255,255,.22)", bottom: 56, height: 5, left: 520, opacity: copyOpacity, position: "absolute", right: 74 }}>
        <div style={{ background: accent, height: "100%", width: `${(visualFrame / Math.max(1, contentDurationInFrames - 1)) * 100}%` }} />
      </div>
      {audio ? (
        <Sequence durationInFrames={narrationFrames}>
          <Audio
            pauseWhenBuffering
            playbackRate={narrationPlaybackRate}
            preload="auto"
            src={audio}
            volume={(audioFrame) => audioVolume(audioFrame, narrationFrames)}
          />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
}

export function KnowVideoComposition({ project }: KnowVideoCompositionProps) {
  let from = 0;
  const narrationRanges: NarrationFrameRange[] = [];
  const settings = productionSettings(project);
  const sceneFrames = project.currentVersion.scenes.map((scene) => (
    Math.max(1, Math.round((scene.durationSeconds * VIDEO_FPS) / settings.playbackRate))
  ));
  const transitionFrames = project.currentVersion.scenes.map((scene, index) => index === 0
    ? 0
    : boundedTransitionFrames({
      scene,
      fps: VIDEO_FPS,
      previousSceneFrames: sceneFrames[index - 1],
      sceneFrames: sceneFrames[index]
    }));
  const logo = productionAsset(project, "logo");
  const music = productionAsset(project, "music");
  const logoPosition = {
    "top-left": { left: 58, top: 52 },
    "top-right": { right: 58, top: 52 },
    "bottom-left": { bottom: 168, left: 58 },
    "bottom-right": { bottom: 168, right: 58 }
  }[settings.logoPosition];

  return (
    <AbsoluteFill style={{ backgroundColor: "#08111f" }}>
      {project.currentVersion.scenes.map((scene, index) => {
        const contentDurationInFrames = sceneFrames[index];
        const transitionInFrames = transitionFrames[index];
        const transitionOutFrames = transitionFrames[index + 1] ?? 0;
        const start = from;
        from += contentDurationInFrames;
        const narrationFrames = narrationDurationInFrames(scene, VIDEO_FPS, settings.playbackRate, contentDurationInFrames);
        if (narrationFrames > 0) {
          narrationRanges.push({ startFrame: start, endFrame: start + narrationFrames - 1 });
        }
        return (
          <Sequence
            durationInFrames={contentDurationInFrames + transitionOutFrames}
            from={start}
            key={scene.id}
            premountFor={VIDEO_FPS * 3}
          >
            <SceneFrame
              captionsEnabled={settings.captionsEnabled}
              captionStyle={settings.captionStyle}
              contentDurationInFrames={contentDurationInFrames}
              projectTitle={project.title}
              playbackRate={settings.playbackRate}
              scene={scene}
              transitionInFrames={transitionInFrames}
              transitionOutFrames={transitionOutFrames}
            />
          </Sequence>
        );
      })}
      {music ? (
        <Audio
          loop
          pauseWhenBuffering
          preload="auto"
          src={music.url}
          volume={(frame) => settings.musicVolume * musicMixEnvelope({
            frame,
            totalFrames: from,
            narrationRanges,
            ducking: settings.musicDucking,
            attackFrames: Math.round(VIDEO_FPS * 0.2),
            releaseFrames: Math.round(VIDEO_FPS * 0.4)
          })}
        />
      ) : null}
      {logo ? (
        <Img
          src={logo.url}
          style={{
            ...logoPosition,
            maxHeight: "16%",
            objectFit: "contain",
            position: "absolute",
            width: `${settings.logoSize}%`
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
}
