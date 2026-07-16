import type { Project, Scene } from "@/lib/types";

export function materializeAppliedVersion(
  project: Project,
  createId: () => string = crypto.randomUUID
): {
  versionId: string;
  assistantMessageId: string;
  directUserMessageId: string;
  scenes: Scene[];
} {
  return {
    versionId: createId(),
    assistantMessageId: createId(),
    directUserMessageId: createId(),
    scenes: project.currentVersion.scenes.map((scene) => ({
      ...scene,
      id: createId(),
      assets: scene.assets
        .filter((asset) => asset.type !== "render")
        .map((asset) => ({ ...asset, id: createId() }))
    }))
  };
}

export function isEditApplicationConflict(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === "23503" || candidate.code === "23505") return true;
  return typeof candidate.message === "string"
    && /(foreign key|duplicate key|修改方案已经失效|版本已经发生变化)/i.test(candidate.message);
}
