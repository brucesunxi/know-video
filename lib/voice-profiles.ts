import type { NarrationVoice } from "@/lib/types";

export const DEFAULT_NARRATION_VOICE: NarrationVoice = "male-clear";

export const narrationVoiceProfiles: Array<{
  id: NarrationVoice;
  label: string;
  shortLabel: string;
  description: string;
  useCase: string;
  sampleText: string;
  azureVoice: string;
  pitch: number;
  rateOffset: number;
  direction: string;
}> = [
  {
    id: "male-clear",
    label: "专业产品男声",
    shortLabel: "产品男声",
    description: "清晰利落、节奏明快，不使用独白腔",
    useCase: "产品介绍 · 科技发布 · 功能演示",
    sampleText: "让复杂流程自动运行，让团队把时间留给更重要的创造。Know Video，帮助企业高效呈现产品价值。",
    azureVoice: "zh-CN-YunxiNeural",
    pitch: -1,
    rateOffset: 2,
    direction: "Professional Mandarin male corporate explainer. Clear, concise and confident, with a polished product-demo cadence. Avoid dramatic monologue, audiobook, radio-host or sales-hype delivery."
  },
  {
    id: "male-deep",
    label: "沉稳品牌男声",
    shortLabel: "品牌男声",
    description: "稳重可信、克制有分量，强调企业价值",
    useCase: "公司介绍 · 企业服务 · 品牌叙事",
    sampleText: "从战略到执行，我们用可靠的自动化能力连接每一个业务环节，让增长更清晰，让决策更从容。",
    azureVoice: "zh-CN-YunyangNeural",
    pitch: -3,
    rateOffset: -2,
    direction: "Grounded Mandarin male corporate brand narration. Calm, credible and restrained, with clear emphasis on business value. Avoid dramatic monologue, documentary gravitas and exaggerated advertising tone."
  },
  {
    id: "female-natural",
    label: "专业商务女声",
    shortLabel: "商务女声",
    description: "专业亲和、表达清楚，适合现代企业内容",
    useCase: "服务介绍 · 客户案例 · 品牌沟通",
    sampleText: "更简单的协作，更智能的流程，让每一次客户沟通都准确、自然，并且值得信赖。",
    azureVoice: "zh-CN-XiaoxiaoNeural",
    pitch: 0,
    rateOffset: 0,
    direction: "Professional Mandarin female business explainer. Warm, articulate and composed, with a modern corporate presentation cadence. Avoid intimate monologue, audiobook and overly cheerful customer-service delivery."
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
  if (/沉稳|稳重|成熟|低沉|权威|品牌男声|商务男声|deep|authoritative|mature|brand voice|business voice/iu.test(request)) return "male-deep";
  if (/男声|男性|男生|清晰|活力|male|man|clear|energetic/iu.test(request)) return "male-clear";
  return undefined;
}

export function narrationVoiceForBrief(request: string): NarrationVoice {
  const explicit = narrationVoiceFromRequest(request);
  if (explicit) return explicit;
  if (/儿童|孩子|亲子|家庭|教育|课程|老师|生活方式|旅行|美妆|健康|温暖|亲和|自然|kids?|children|family|education|teacher|lifestyle|travel|beauty|wellness|warm|friendly/iu.test(request)) {
    return "female-natural";
  }
  if (/金融|法律|治理|政务|企业级|工业|纪录片|历史|权威|严肃|稳重|公司介绍|企业介绍|品牌介绍|企业服务|自动化公司|finance|legal|governance|enterprise|industrial|documentary|history|authoritative|serious|company profile|corporate profile|brand story/iu.test(request)) {
    return "male-deep";
  }
  return DEFAULT_NARRATION_VOICE;
}
