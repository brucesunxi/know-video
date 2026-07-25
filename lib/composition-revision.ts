import type { ProjectVersion } from "@/lib/types";

export function compositionRevision(version: ProjectVersion) {
  return JSON.stringify({
    durationSeconds: version.durationSeconds,
    scenes: version.scenes.map((scene) => ({
      id: scene.id,
      sceneNumber: scene.sceneNumber,
      durationSeconds: scene.durationSeconds,
      title: scene.title,
      voiceover: scene.voiceover,
      motionPrompt: scene.motionPrompt,
      style: scene.style,
      assets: scene.assets.map((asset) => ({
        id: asset.id,
        type: asset.type,
        url: asset.url,
        r2Key: asset.r2Key,
        metadata: asset.metadata
      }))
    }))
  });
}
