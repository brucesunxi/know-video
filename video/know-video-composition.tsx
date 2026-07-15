import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig
} from "remotion";
import type { Project, Scene } from "@/lib/types";
import { VIDEO_FPS } from "@/video/config";

export type KnowVideoCompositionProps = { project: Project };

function sceneImage(scene: Scene) {
  return scene.assets.find((asset) => asset.type === "clip" && asset.url)?.url
    ?? scene.assets.find((asset) => asset.type === "image" && asset.url)?.url;
}

function SceneFrame({ scene, projectTitle, sceneIndex }: { scene: Scene; projectTitle: string; sceneIndex: number }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const entrance = spring({ frame, fps: VIDEO_FPS, config: { damping: 18, mass: 0.8 } });
  const fade = interpolate(
    frame,
    [0, 12, Math.max(13, durationInFrames - 12), durationInFrames - 1],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const drift = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, sceneIndex % 2 === 0 ? -2.8 : 2.8]);
  const zoom = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [1.035, 1.11]);
  const image = sceneImage(scene);
  const audio = scene.assets.find((asset) => asset.type === "audio" && asset.url)?.url;

  return (
    <AbsoluteFill style={{ backgroundColor: "#08111f", opacity: fade, overflow: "hidden" }}>
      {image ? (
        <Img
          src={image}
          style={{
            height: "106%",
            left: `${drift}%`,
            objectFit: "cover",
            position: "absolute",
            top: "-3%",
            transform: `scale(${zoom})`,
            width: "106%"
          }}
        />
      ) : null}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(2,8,18,.12) 0%, rgba(2,8,18,.05) 45%, rgba(2,8,18,.86) 100%)" }} />
      <AbsoluteFill style={{ background: "linear-gradient(90deg, rgba(2,8,18,.48), transparent 58%)" }} />
      <div style={{ color: "rgba(255,255,255,.78)", fontFamily: "Arial, sans-serif", fontSize: 24, fontWeight: 700, left: 74, position: "absolute", top: 60 }}>
        KNOW VIDEO&nbsp;&nbsp;/&nbsp;&nbsp;{String(scene.sceneNumber).padStart(2, "0")}
      </div>
      <div
        style={{
          bottom: 180,
          color: "white",
          fontFamily: "Arial, sans-serif",
          left: 74,
          maxWidth: 1320,
          opacity: entrance,
          position: "absolute",
          right: 74,
          transform: `translateY(${(1 - entrance) * 38}px)`
        }}
      >
        <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.08, textShadow: "0 4px 30px rgba(0,0,0,.38)" }}>{scene.title}</div>
        <div style={{ fontSize: 32, fontWeight: 500, lineHeight: 1.45, marginTop: 26, maxWidth: 1420, textShadow: "0 3px 22px rgba(0,0,0,.7)" }}>{scene.voiceover}</div>
      </div>
      <div style={{ bottom: 62, color: "rgba(255,255,255,.7)", fontFamily: "Arial, sans-serif", fontSize: 20, left: 74, position: "absolute" }}>{projectTitle}</div>
      <div style={{ background: "rgba(255,255,255,.22)", bottom: 66, height: 5, left: 520, position: "absolute", right: 74 }}>
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
      {project.currentVersion.scenes.map((scene, index) => {
        const durationInFrames = Math.max(1, Math.round(scene.durationSeconds * VIDEO_FPS));
        const start = from;
        from += durationInFrames;
        return (
          <Sequence durationInFrames={durationInFrames} from={start} key={scene.id} premountFor={VIDEO_FPS}>
            <SceneFrame projectTitle={project.title} scene={scene} sceneIndex={index} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
