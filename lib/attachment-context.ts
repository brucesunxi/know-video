import type { ProjectVersion, Scene, SceneAsset } from "@/lib/types";

function assetName(asset: SceneAsset) {
  return String(asset.metadata?.name ?? asset.type);
}

function isUserProvided(asset: SceneAsset) {
  return asset.metadata?.source === "user-upload";
}

function assetRoleLabel(asset: SceneAsset) {
  if (asset.type === "image") return "current visual reference";
  if (asset.type === "clip") return "current motion/video reference";
  if (asset.type === "audio") return "current narration/audio reference";
  if (asset.type === "logo") return "production logo";
  if (asset.type === "music") return "production music";
  return "supporting reference";
}

export function userAttachmentAssets(scene: Scene) {
  return scene.assets.filter(isUserProvided);
}

export function sceneAttachmentSummary(scene: Scene) {
  const assets = userAttachmentAssets(scene);
  if (assets.length === 0) return undefined;
  return [
    `Scene ${scene.sceneNumber} user attachments:`,
    ...assets.map((asset) => {
      const contentType = typeof asset.metadata?.contentType === "string" ? `, ${asset.metadata.contentType}` : "";
      return `- ${assetRoleLabel(asset)} "${assetName(asset)}"${contentType}.`;
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
