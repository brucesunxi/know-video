import { generateProjectVoices } from "@/lib/audio-assets";
import { recordUsageEvent } from "@/lib/billing/usage";
import {
  completeGenerationRequest,
  failGenerationRequest,
  touchGenerationRequest
} from "@/lib/generation-requests";
import { generateProjectSceneImages } from "@/lib/image-assets";
import { enqueueProjectMediaScene, type ProjectMediaMessage } from "@/lib/media-generation-queue";
import { loadProjectForRender, persistGeneratedSceneAssets } from "@/lib/project-mutations";
import { generateProjectStockClips, hasFreeStockVideoProvider } from "@/lib/stock-video-assets";
import type { Project, SceneAsset } from "@/lib/types";

function sceneAsset(project: Project, sceneNumber: number, type: SceneAsset["type"]) {
  return project.currentVersion.scenes
    .find((scene) => scene.sceneNumber === sceneNumber)
    ?.assets.find((asset) => asset.type === type && asset.url);
}

async function requireCurrentProject(message: ProjectMediaMessage) {
  const project = await loadProjectForRender(message.projectId, message.versionId, message.userId);
  if (!project) throw new Error("The queued video version is no longer current.");
  return project;
}

async function ensureSceneImage(message: ProjectMediaMessage, project: Project) {
  if (sceneAsset(project, message.sceneNumber, "image")) return project;
  const updated = await generateProjectSceneImages(project, {
    replaceExistingImages: true,
    sceneNumbers: [message.sceneNumber],
    quality: "standard"
  });
  const generated = sceneAsset(updated, message.sceneNumber, "image");
  if (!generated) throw new Error(`Scene ${message.sceneNumber} visual generation did not produce a usable image.`);
  await persistGeneratedSceneAssets(message.versionId, updated.currentVersion.scenes, {
    replaceImages: true,
    sceneNumbers: [message.sceneNumber]
  });
  await recordUsageEvent({
    userId: message.userId,
    projectId: message.projectId,
    versionId: message.versionId,
    resourceType: "image_standard",
    quantity: 1,
    idempotencyKey: `image_standard:${message.requestId}:scene:${message.sceneNumber}`,
    status: "settled",
    metadata: { sceneNumber: message.sceneNumber, assetKey: generated.r2Key, source: "background_queue" }
  });
  return requireCurrentProject(message);
}

async function ensureSceneNarration(message: ProjectMediaMessage, project: Project) {
  if (sceneAsset(project, message.sceneNumber, "audio")) return project;
  const updated = await generateProjectVoices(
    project,
    [message.sceneNumber],
    message.options?.narrationVoice
  );
  const generated = sceneAsset(updated, message.sceneNumber, "audio");
  if (!generated) throw new Error(`Scene ${message.sceneNumber} narration generation did not produce usable audio.`);
  await persistGeneratedSceneAssets(message.versionId, updated.currentVersion.scenes, {
    replaceAudio: true,
    sceneNumbers: [message.sceneNumber],
    updateStyles: Boolean(message.options?.narrationVoice),
    updateNarration: true
  });
  const duration = Number(generated.metadata?.actualDurationSeconds)
    || project.currentVersion.scenes.find((scene) => scene.sceneNumber === message.sceneNumber)?.durationSeconds
    || 1;
  await recordUsageEvent({
    userId: message.userId,
    projectId: message.projectId,
    versionId: message.versionId,
    resourceType: "speech",
    quantity: duration,
    idempotencyKey: `speech:${message.requestId}:scene:${message.sceneNumber}`,
    status: "settled",
    metadata: {
      sceneNumber: message.sceneNumber,
      narrationVoice: message.options?.narrationVoice,
      assetKey: generated.r2Key,
      source: "background_queue"
    }
  });
  return requireCurrentProject(message);
}

async function addFreeStockMotion(message: ProjectMediaMessage, project: Project) {
  if (message.options?.motion !== "stock" || !hasFreeStockVideoProvider()) return project;
  if (sceneAsset(project, message.sceneNumber, "clip")) return project;
  const result = await generateProjectStockClips(project, [message.sceneNumber]);
  await persistGeneratedSceneAssets(message.versionId, result.project.currentVersion.scenes, {
    replaceClips: true,
    sceneNumbers: [message.sceneNumber],
    updateStyles: true
  });
  if (result.failures.length > 0) {
    console.warn(`[background-media] Scene ${message.sceneNumber} has no matching free stock clip; local motion remains active.`);
  }
  return requireCurrentProject(message);
}

export async function processProjectMediaScene(message: ProjectMediaMessage) {
  await touchGenerationRequest(message.requestId);
  let project = await requireCurrentProject(message);
  project = await ensureSceneImage(message, project);
  project = await ensureSceneNarration(message, project);
  project = await addFreeStockMotion(message, project);

  const sceneNumbers = project.currentVersion.scenes.map((scene) => scene.sceneNumber).sort((a, b) => a - b);
  const currentIndex = sceneNumbers.indexOf(message.sceneNumber);
  const nextSceneNumber = currentIndex >= 0 ? sceneNumbers[currentIndex + 1] : undefined;
  if (nextSceneNumber) {
    await enqueueProjectMediaScene({ ...message, sceneNumber: nextSceneNumber });
    return;
  }

  const refreshed = await requireCurrentProject(message);
  const incomplete = refreshed.currentVersion.scenes.filter((scene) => {
    const hasImage = scene.assets.some((asset) => asset.type === "image" && asset.url);
    const hasAudio = scene.assets.some((asset) => asset.type === "audio" && asset.url);
    return !hasImage || !hasAudio;
  });
  if (incomplete.length > 0) {
    const first = incomplete.sort((a, b) => a.sceneNumber - b.sceneNumber)[0];
    await enqueueProjectMediaScene({ ...message, sceneNumber: first.sceneNumber });
    return;
  }
  await completeGenerationRequest({
    id: message.requestId,
    projectId: message.projectId,
    engine: message.engine
  });
}

export async function permanentlyFailProjectMedia(message: ProjectMediaMessage, error: unknown) {
  const reason = error instanceof Error ? error.message : "Unknown media generation failure";
  await failGenerationRequest(
    message.requestId,
    `后台已多次自动重试，但场景 ${message.sceneNumber} 的素材仍未完成：${reason}`
  );
}
