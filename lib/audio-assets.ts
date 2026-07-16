import OpenAI from "openai";
import { generateAzureChineseSpeech, hasAzureSpeech } from "@/lib/azure-speech";
import { generateCloudflareSpeech, hasCloudflareAI } from "@/lib/cloudflare-ai";
import { getOptionalEnv } from "@/lib/env";
import { assetUrlForKey, uploadToR2 } from "@/lib/r2";
import type { Project, Scene, SceneAsset } from "@/lib/types";

function containsChinese(text: string) {
  return /\p{Script=Han}/u.test(text);
}

async function generateSceneVoice(scene: Scene, project: Project): Promise<SceneAsset> {
  let body: Buffer;
  let model: string;
  let voice: string;
  let contentType: "audio/mpeg" | "audio/wav";
  let extension: "mp3" | "wav";
  let rate: number | undefined;
  if (containsChinese(scene.voiceover)) {
    if (!hasAzureSpeech()) {
      throw new Error("Chinese narration requires AZURE_SPEECH_KEY and AZURE_SPEECH_REGION");
    }
    const generated = await generateAzureChineseSpeech(scene.voiceover, scene.durationSeconds);
    body = generated.body;
    model = generated.model;
    voice = generated.voice;
    rate = generated.rate;
    contentType = generated.contentType;
    extension = generated.extension;
  } else if (hasCloudflareAI()) {
    const generated = await generateCloudflareSpeech(scene.voiceover);
    body = generated.body;
    model = generated.model;
    voice = "default";
    contentType = generated.contentType;
    extension = generated.extension;
  } else {
    const client = new OpenAI({ apiKey: getOptionalEnv("OPENAI_API_KEY") });
    model = getOptionalEnv("OPENAI_TTS_MODEL") || "gpt-4o-mini-tts";
    voice = getOptionalEnv("OPENAI_TTS_VOICE") || "alloy";
    const result = await client.audio.speech.create({
      model,
      voice: voice as "alloy",
      input: scene.voiceover,
      response_format: "mp3",
      instructions: "Natural, confident product-film narration. Match the language of the text. Keep a composed, premium pace."
    });
    body = Buffer.from(await result.arrayBuffer());
    contentType = "audio/mpeg";
    extension = "mp3";
  }
  const key = `generated/${project.id}/${project.currentVersion.id}/scene-${scene.sceneNumber}-voice-${crypto.randomUUID()}.${extension}`;
  const uploaded = await uploadToR2({ key, body, contentType });

  return {
    id: crypto.randomUUID(),
    type: "audio",
    r2Key: uploaded.key,
    url: assetUrlForKey(uploaded.key, uploaded.publicUrl),
    metadata: {
      source: "ai-speech",
      model,
      voice,
      contentType,
      sceneNumber: scene.sceneNumber,
      targetDurationSeconds: scene.durationSeconds,
      rate
    }
  };
}

export async function generateProjectVoices(project: Project, sceneNumbers?: number[]) {
  if (
    (!hasAzureSpeech() && !hasCloudflareAI() && !getOptionalEnv("OPENAI_API_KEY"))
    || getOptionalEnv("ENABLE_TTS") === "false"
  ) return project;
  const selected = sceneNumbers ? new Set(sceneNumbers) : undefined;
  const scenes = await Promise.all(project.currentVersion.scenes.map(async (scene) => {
    if (selected && !selected.has(scene.sceneNumber)) return scene;
    try {
      const voice = await generateSceneVoice(scene, project);
      return { ...scene, assets: [voice, ...scene.assets.filter((asset) => asset.type !== "audio")] };
    } catch (error) {
      console.error(`[audio-assets] Scene ${scene.sceneNumber} voice generation failed:`, error);
      // A failed Chinese regeneration must not leave a previously broken MeloTTS track active.
      return containsChinese(scene.voiceover)
        ? { ...scene, assets: scene.assets.filter((asset) => asset.type !== "audio") }
        : scene;
    }
  }));

  return { ...project, currentVersion: { ...project.currentVersion, scenes } };
}
