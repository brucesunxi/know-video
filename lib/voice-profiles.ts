import type { NarrationVoice } from "@/lib/types";

export const DEFAULT_NARRATION_VOICE: NarrationVoice = "male-clear";

export const narrationVoiceProfiles: Array<{
  id: NarrationVoice;
  label: string;
  description: string;
  azureVoice: string;
  direction: string;
}> = [
  {
    id: "male-clear",
    label: "清晰男声",
    description: "清楚、有活力，适合产品介绍",
    azureVoice: "zh-CN-YunxiNeural",
    direction: "Clear Mandarin male narration with an energetic, polished product-film delivery."
  },
  {
    id: "male-deep",
    label: "沉稳男声",
    description: "稳重、可信，适合品牌与商业叙事",
    azureVoice: "zh-CN-YunyangNeural",
    direction: "Grounded Mandarin male narration with a calm, authoritative commercial documentary delivery."
  },
  {
    id: "female-natural",
    label: "自然女声",
    description: "自然、亲和，适合教育与生活方式内容",
    azureVoice: "zh-CN-XiaoxiaoNeural",
    direction: "Natural Mandarin female narration with warm, articulate, premium storytelling."
  }
];

export function narrationVoiceProfile(value?: string) {
  return narrationVoiceProfiles.find((profile) => profile.id === value)
    ?? narrationVoiceProfiles.find((profile) => profile.id === DEFAULT_NARRATION_VOICE)!;
}

export function isNarrationVoice(value: unknown): value is NarrationVoice {
  return narrationVoiceProfiles.some((profile) => profile.id === value);
}

export function narrationVoiceFromRequest(request: string): NarrationVoice | undefined {
  if (!/音色|声音|男声|女声|配音|voice|narrat/iu.test(request)) return undefined;
  if (/女声|女性|女生|female|woman/iu.test(request)) return "female-natural";
  if (/沉稳|稳重|成熟|低沉|权威|deep|authoritative|mature/iu.test(request)) return "male-deep";
  if (/男声|男性|男生|清晰|活力|male|man|clear|energetic/iu.test(request)) return "male-clear";
  return undefined;
}

export function narrationVoiceForBrief(request: string): NarrationVoice {
  const explicit = narrationVoiceFromRequest(request);
  if (explicit) return explicit;
  if (/儿童|孩子|亲子|家庭|教育|课程|老师|生活方式|旅行|美妆|健康|温暖|亲和|自然|kids?|children|family|education|teacher|lifestyle|travel|beauty|wellness|warm|friendly/iu.test(request)) {
    return "female-natural";
  }
  if (/金融|法律|治理|政务|企业级|工业|纪录片|历史|权威|严肃|稳重|finance|legal|governance|enterprise|industrial|documentary|history|authoritative|serious/iu.test(request)) {
    return "male-deep";
  }
  return DEFAULT_NARRATION_VOICE;
}
