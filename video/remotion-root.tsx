import React from "react";
import { Composition, registerRoot } from "remotion";
import { demoProject } from "@/lib/mock-data";
import { productionDurationInFrames } from "@/lib/production-settings";
import { KnowVideoComposition, type KnowVideoCompositionProps } from "@/video/know-video-composition";
import { VIDEO_COMPOSITION_ID, VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "@/video/config";

function RemotionRoot() {
  return (
    <Composition
      id={VIDEO_COMPOSITION_ID}
      component={KnowVideoComposition}
      defaultProps={{ project: demoProject }}
      durationInFrames={demoProject.currentVersion.durationSeconds * VIDEO_FPS}
      fps={VIDEO_FPS}
      height={VIDEO_HEIGHT}
      width={VIDEO_WIDTH}
      calculateMetadata={({ props }: { props: KnowVideoCompositionProps }) => ({
        durationInFrames: productionDurationInFrames(props.project.currentVersion, VIDEO_FPS)
      })}
    />
  );
}

registerRoot(RemotionRoot);
