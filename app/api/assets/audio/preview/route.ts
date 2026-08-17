import { NextResponse } from "next/server";
import { z } from "zod";
import { authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { generateAzureSpeech } from "@/lib/azure-speech";
import { isNarrationVoice, narrationVoiceProfile } from "@/lib/voice-profiles";

const requestSchema = z.object({
  voice: z.string().refine(isNarrationVoice),
  language: z.enum(["中文", "英文"])
});

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    await requireCurrentUser();
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    throw error;
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return NextResponse.json({ error: "请选择有效的配音音色。" }, { status: 400 });
  }

  try {
    const profile = narrationVoiceProfile(parsed.data.voice);
    const english = parsed.data.language === "英文";
    const generated = await generateAzureSpeech(
      english ? profile.sampleTextEn : profile.sampleText,
      undefined,
      profile.id,
      english ? "en-US" : "zh-CN"
    );
    return new NextResponse(new Uint8Array(generated.body), {
      headers: {
        "Cache-Control": "private, max-age=3600",
        "Content-Type": generated.contentType,
        "Content-Length": String(generated.body.length)
      }
    });
  } catch (error) {
    console.error("[audio-preview] Voice preview failed:", error);
    return NextResponse.json({ error: "试听生成失败，请稍后重试。" }, { status: 502 });
  }
}
