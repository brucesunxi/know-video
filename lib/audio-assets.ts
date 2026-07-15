import OpenAI from "openai";
import { getOptionalEnv } from "@/lib/env";
import { assetUrlForKey, uploadToR2 } from "@/lib/r2";
import type { Project, Scene, SceneAsset } from "@/lib/types";

async function generateSceneVoice(scene: Scene, project: Project): Promise<SceneAsset> {
  const client = new OpenAI({ apiKey: getOptionalEnv("OPENAI_API_KEY") });
  const model = getOptionalEnv("OPENAI_TTS_MODEL") || "gpt-4o-mini-tts";
  const voice = getOptionalEnv("OPENAI_TTS_VOICE") || "alloy";
  const result = await client.audio.speech.create({
    model,
    voice: voice as "alloy",
    input: scene.voiceover,
    response_format: "mp3",
    instructions: "Natural, confident product-film narration. Match the language of the text. Keep a composed, premium pace."
  });
  const key = `generated/${project.id}/${project.currentVersion.id}/scene-${scene.sceneNumber}-voice-${crypto.randomUUID()}.mp3`;
  const uploaded = await uploadToR2({ key, body: Buffer.from(await result.arrayBuffer()), contentType: "audio/mpeg" });

  return {
    id: crypto.randomUUID(),
    type: "audio",
    r2Key: uploaded.key,
    url: assetUrlForKey(uploaded.key, uploaded.publicUrl),
    metadata: { source: "ai-speech", model, voice, sceneNumber: scene.sceneNumber }
  };
}

export async function generateProjectVoices(project: Project, sceneNumbers?: number[]) {
  if (!getOptionalEnv("OPENAI_API_KEY") || getOptionalEnv("ENABLE_TTS") === "false") return project;
  const selected = sceneNumbers ? new Set(sceneNumbers) : undefined;
  const scenes = await Promise.all(project.currentVersion.scenes.map(async (scene) => {
    if (selected && !selected.has(scene.sceneNumber)) return scene;
    try {
      const voice = await generateSceneVoice(scene, project);
      return { ...scene, assets: [voice, ...scene.assets.filter((asset) => asset.type !== "audio")] };
    } catch (error) {
      console.error(`[audio-assets] Scene ${scene.sceneNumber} voice generation failed:`, error);
      return scene;
    }
  }));

  return { ...project, currentVersion: { ...project.currentVersion, scenes } };
}

