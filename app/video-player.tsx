"use client";

import { Player, type PlayerRef } from "@remotion/player";
import { forwardRef } from "react";
import type { Project } from "@/lib/types";
import { KnowVideoComposition } from "@/video/know-video-composition";
import { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "@/video/config";

export const KnowVideoPlayer = forwardRef<PlayerRef, { project: Project; className?: string }>(function KnowVideoPlayer(
  { project, className },
  ref
) {
  return (
    <div className={className}>
      <Player
        ref={ref}
        component={KnowVideoComposition}
        inputProps={{ project }}
        durationInFrames={Math.max(1, Math.round(project.currentVersion.durationSeconds * VIDEO_FPS))}
        compositionWidth={VIDEO_WIDTH}
        compositionHeight={VIDEO_HEIGHT}
        fps={VIDEO_FPS}
        controls
        clickToPlay
        doubleClickToFullscreen
        spaceKeyToPlayOrPause
        style={{ height: "100%", width: "100%" }}
      />
    </div>
  );
});

