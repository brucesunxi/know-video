import type { GenerationReferenceAsset, ProjectVersion, Scene, SceneAsset } from "@/lib/types";

function assetName(asset: SceneAsset) {
  return String(asset.metadata?.name ?? asset.type);
}

function isUserProvided(asset: SceneAsset) {
  return asset.metadata?.source === "user-upload";
}

function referenceFromAsset(asset: SceneAsset): GenerationReferenceAsset | undefined {
  if (!isUserProvided(asset)) return undefined;
  const contentType = String(asset.metadata?.contentType ?? "");
  const size = Number(asset.metadata?.size);
  if (!asset.r2Key || !contentType) return undefined;
  return {
    key: asset.r2Key,
    name: assetName(asset),
    size: Number.isFinite(size) && size > 0 ? size : 0,
    contentType
  };
}

export function referenceDescriptor(asset: SceneAsset): GenerationReferenceAsset {
  return {
    key: asset.r2Key,
    name: assetName(asset),
    size: Number(asset.metadata?.size ?? 0),
    contentType: String(asset.metadata?.contentType ?? "application/octet-stream")
  };
}

export function sceneReferenceAssets(scene: Scene) {
  const references = [
    ...(scene.style.referenceAssets ?? []),
    ...scene.assets.map(referenceFromAsset).filter(Boolean) as GenerationReferenceAsset[]
  ];
  return references.filter((reference, index) => (
    references.findIndex((candidate) => candidate.key === reference.key) === index
  ));
}

export function userAttachmentAssets(scene: Scene) {
  return scene.assets.filter(isUserProvided);
}

export function sceneAttachmentSummary(scene: Scene) {
  const references = sceneReferenceAssets(scene);
  if (references.length === 0) return undefined;
  return [
    `Scene ${scene.sceneNumber} user attachments:`,
    ...references.map((reference) => {
      const role = reference.contentType.startsWith("image/")
        ? "visual identity and composition reference"
        : reference.contentType.startsWith("video/")
          ? "source footage and motion reference"
          : reference.contentType.startsWith("audio/")
            ? "source narration or audio reference"
            : "supporting reference";
      return `- ${role} "${reference.name}", ${reference.contentType}.`;
    }),
    "Use these attachments as user-provided source material. Preserve visible product/person/style identity from uploaded visuals unless the user explicitly asks to replace it. Preserve uploaded narration or music intent unless the user asks to regenerate audio."
  ].join("\n");
}

export function versionAttachmentContext(version: ProjectVersion) {
  const sceneSummaries = version.scenes.map(sceneAttachmentSummary).filter(Boolean);
  if (sceneSummaries.length === 0) return "";
  return [
    "User-provided attachment context:",
    ...sceneSummaries,
    "When planning edits, mention only the scenes that actually need changes. If an attachment already satisfies the user's request, keep it and do not unnecessarily regenerate it."
  ].join("\n\n");
}
