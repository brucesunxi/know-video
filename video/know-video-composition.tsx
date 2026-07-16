import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig
} from "remotion";
import type { Project, Scene } from "@/lib/types";
import { VIDEO_FPS } from "@/video/config";

export type KnowVideoCompositionProps = { project: Project };

function captionParts(text: string) {
  const parts = text.match(/[^，。！？；,.!?]+[，。！？；,.!?]?/g)
    ?.map((part) => part.trim())
    .filter(Boolean);
  return parts?.length ? parts : [text];
}

function activeCaption(text: string, frame: number, durationInFrames: number) {
  const parts = captionParts(text);
  const totalWeight = parts.reduce((sum, part) => sum + Math.max(1, part.length), 0);
  const position = (frame / Math.max(1, durationInFrames - 1)) * totalWeight;
  let cursor = 0;
  for (const part of parts) {
    cursor += Math.max(1, part.length);
    if (position <= cursor) return part;
  }
  return parts[parts.length - 1];
}

function motionValues(scene: Scene, frame: number, durationInFrames: number) {
  const progressRange = [0, Math.max(1, durationInFrames - 1)];
  const direction = scene.motionPrompt.toLowerCase();
  const pansRight = direction.includes("right") || direction.includes("向右");
  const pansLeft = direction.includes("left") || direction.includes("向左");
  const pullsBack = direction.includes("pull") || direction.includes("zoom out") || direction.includes("拉远");
  const x = pansRight
    ? interpolate(frame, progressRange, [-2.2, 2.2])
    : pansLeft
      ? interpolate(frame, progressRange, [2.2, -2.2])
      : interpolate(frame, progressRange, [0, scene.sceneNumber % 2 === 0 ? -1.4 : 1.4]);
  const scale = pullsBack
    ? interpolate(frame, progressRange, [1.12, 1.035])
    : interpolate(frame, progressRange, [1.035, 1.105]);
  return { x, scale };
}

function SceneFrame({ scene, projectTitle }: { scene: Scene; projectTitle: string }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const entrance = spring({ frame, fps: VIDEO_FPS, config: { damping: 18, mass: 0.8 } });
  const fade = interpolate(
    frame,
    [0, 12, Math.max(13, durationInFrames - 12), durationInFrames - 1],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const motion = motionValues(scene, frame, durationInFrames);
  const caption = activeCaption(scene.voiceover, frame, durationInFrames);
  const clip = scene.assets.find((asset) => asset.type === "clip" && asset.url)?.url;
  const image = scene.assets.find((asset) => asset.type === "image" && asset.url)?.url;
  const audio = scene.assets.find((asset) => asset.type === "audio" && asset.url)?.url;

  return (
    <AbsoluteFill style={{ backgroundColor: "#08111f", opacity: fade, overflow: "hidden" }}>
      {clip ? (
        <OffthreadVideo
          muted
          src={clip}
          style={{ height: "106%", objectFit: "cover", position: "absolute", top: "-3%", width: "106%" }}
        />
      ) : image ? (
        <Img
          src={image}
          style={{
            height: "106%",
            left: `${motion.x}%`,
            objectFit: "cover",
            position: "absolute",
            top: "-3%",
            transform: `scale(${motion.scale})`,
            width: "106%"
          }}
        />
      ) : null}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(2,8,18,.16) 0%, rgba(2,8,18,.02) 42%, rgba(2,8,18,.9) 100%)" }} />
      <AbsoluteFill style={{ background: "linear-gradient(90deg, rgba(2,8,18,.5), transparent 62%)" }} />
      <AbsoluteFill style={{ boxShadow: "inset 0 0 180px rgba(0,0,0,.3)" }} />
      <div style={{ color: "rgba(255,255,255,.78)", fontFamily: "Arial, PingFang SC, Microsoft YaHei, sans-serif", fontSize: 23, fontWeight: 700, left: 74, position: "absolute", top: 60 }}>
        KNOW VIDEO&nbsp;&nbsp;/&nbsp;&nbsp;{String(scene.sceneNumber).padStart(2, "0")}
      </div>
      <div
        style={{
          bottom: 214,
          color: "white",
          fontFamily: "Arial, PingFang SC, Microsoft YaHei, sans-serif",
          left: 74,
          maxWidth: 1320,
          opacity: entrance,
          position: "absolute",
          right: 74,
          transform: `translateY(${(1 - entrance) * 38}px)`
        }}
      >
        <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.1, maxWidth: 1320, textShadow: "0 4px 30px rgba(0,0,0,.42)" }}>{scene.title}</div>
      </div>
      <div
        style={{
          bottom: 102,
          left: "50%",
          maxWidth: 1420,
          padding: "13px 24px 15px",
          position: "absolute",
          transform: "translateX(-50%)",
          borderRadius: 8,
          background: "rgba(2,8,18,.76)",
          color: "#fff",
          fontFamily: "Arial, PingFang SC, Microsoft YaHei, sans-serif",
          fontSize: 31,
          fontWeight: 600,
          lineHeight: 1.35,
          textAlign: "center",
          textShadow: "0 2px 12px rgba(0,0,0,.65)"
        }}
      >{caption}</div>
      <div style={{ bottom: 52, color: "rgba(255,255,255,.7)", fontFamily: "Arial, PingFang SC, Microsoft YaHei, sans-serif", fontSize: 19, left: 74, position: "absolute" }}>{projectTitle}</div>
      <div style={{ background: "rgba(255,255,255,.22)", bottom: 56, height: 5, left: 520, position: "absolute", right: 74 }}>
        <div style={{ background: "#22c7b8", height: "100%", width: `${(frame / Math.max(1, durationInFrames - 1)) * 100}%` }} />
      </div>
      {audio ? <Audio src={audio} volume={0.96} /> : null}
    </AbsoluteFill>
  );
}

export function KnowVideoComposition({ project }: KnowVideoCompositionProps) {
  let from = 0;

  return (
    <AbsoluteFill style={{ backgroundColor: "#08111f" }}>
      {project.currentVersion.scenes.map((scene) => {
        const durationInFrames = Math.max(1, Math.round(scene.durationSeconds * VIDEO_FPS));
        const start = from;
        from += durationInFrames;
        return (
          <Sequence durationInFrames={durationInFrames} from={start} key={scene.id} premountFor={VIDEO_FPS}>
            <SceneFrame projectTitle={project.title} scene={scene} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
