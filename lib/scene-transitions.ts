import type { Scene, SceneTransitionKind } from "@/lib/types";

export type ResolvedSceneTransitionKind = Exclude<SceneTransitionKind, "auto">;

function inferredTransitionKind(scene: Pick<Scene, "motionPrompt" | "sceneNumber">): ResolvedSceneTransitionKind {
  const direction = scene.motionPrompt.toLowerCase();
  if (direction.includes("wipe") || direction.includes("遮罩") || direction.includes("擦除")) return "wipe";
  if (direction.includes("right") || direction.includes("向右")) return "push-right";
  if (direction.includes("left") || direction.includes("向左")) return "push-left";
  if (direction.includes("zoom") || /push(?:es|ed|ing)?\s+in/.test(direction) || direction.includes("推进") || direction.includes("推近")) return "zoom";
  return scene.sceneNumber % 4 === 0
    ? "wipe"
    : scene.sceneNumber % 3 === 0
      ? "zoom"
      : "dissolve";
}

export function resolvedSceneTransition(scene: Pick<Scene, "motionPrompt" | "sceneNumber" | "style">) {
  const configured = scene.style.transition;
  const kind = !configured || configured.kind === "auto"
    ? inferredTransitionKind(scene)
    : configured.kind;
  const requestedDuration = Number(
    !configured || configured.kind === "auto"
      ? 0.25
      : configured.durationSeconds
  );
  return {
    kind,
    durationSeconds: kind === "cut" ? 0 : Math.min(1.2, Math.max(0.2, requestedDuration))
  };
}

export function boundedTransitionFrames(input: {
  scene: Pick<Scene, "motionPrompt" | "sceneNumber" | "style">;
  fps: number;
  previousSceneFrames: number;
  sceneFrames: number;
}) {
  const transition = resolvedSceneTransition(input.scene);
  if (transition.kind === "cut") return 0;
  return Math.max(1, Math.min(
    Math.round(transition.durationSeconds * input.fps),
    Math.floor(input.previousSceneFrames / 3),
    Math.floor(input.sceneFrames / 3)
  ));
}
