import { assertUsableSpeechAudio } from "@/lib/audio-quality";
import { hasCloudflareAI, transcribeCloudflareAudio } from "@/lib/cloudflare-ai";

export async function inspectUploadedNarration(body: Buffer, sceneDurationSeconds: number) {
  const inspection = assertUsableSpeechAudio(body, { targetDurationSeconds: sceneDurationSeconds });
  if (!hasCloudflareAI()) {
    throw new Error("当前无法识别上传配音，请检查语音识别服务配置后重试。");
  }
  const transcribed = await transcribeCloudflareAudio(body);
  return {
    actualDurationSeconds: inspection.durationSeconds,
    transcript: transcribed.transcript,
    transcriptionModel: transcribed.model
  };
}
