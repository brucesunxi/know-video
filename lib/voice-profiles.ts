import type { NarrationVoice } from "@/lib/types";

export const DEFAULT_NARRATION_VOICE: NarrationVoice = "male-clear";

export const narrationVoiceProfiles: Array<{
  id: NarrationVoice;
  label: string;
  shortLabel: string;
  description: string;
  useCase: string;
  sampleText: string;
  labelEn: string;
  shortLabelEn: string;
  descriptionEn: string;
  useCaseEn: string;
  sampleTextEn: string;
  azureVoiceZh: string;
  azureVoiceEn: string;
  pitch: number;
  directionZh: string;
  directionEn: string;
}> = [
  {
    id: "male-clear",
    label: "清晰活力男声",
    shortLabel: "活力男声",
    description: "自然利落、富有行动感，不使用汇报腔或独白腔",
    useCase: "游戏介绍 · 科技发布 · 功能演示",
    sampleText: "踏进新的世界，观察环境、选择路线，用自己的操作破解挑战。下一局，会由你创造出完全不同的结果。",
    labelEn: "Clear energetic male",
    shortLabelEn: "Energetic male",
    descriptionEn: "Clear, natural, and action-oriented delivery",
    useCaseEn: "Game intros · Tech launches · Product demos",
    sampleTextEn: "Step into a new world, read the environment, choose your path, and solve each challenge through your own decisions.",
    azureVoiceZh: "zh-CN-YunxiNeural",
    azureVoiceEn: "en-US-GuyNeural",
    pitch: -1,
    directionZh: "Clear, energetic Mandarin male trailer narration. Natural and action-oriented, with varied emphasis and short clean pauses. Avoid corporate presentation, product-demo cadence, dramatic monologue, audiobook, radio-host or sales-hype delivery.",
    directionEn: "Clear, energetic English male trailer narration. Natural and action-oriented, with varied emphasis and short clean pauses. Avoid corporate presentation, audiobook, radio-host, or exaggerated sales delivery."
  },
  {
    id: "male-deep",
    label: "沉稳品牌男声",
    shortLabel: "品牌男声",
    description: "稳重可信、克制有分量，强调企业价值",
    useCase: "公司介绍 · 企业服务 · 品牌叙事",
    sampleText: "从战略到执行，我们用可靠的自动化能力连接每一个业务环节，让增长更清晰，让决策更从容。",
    labelEn: "Grounded brand male",
    shortLabelEn: "Brand male",
    descriptionEn: "Calm, credible, and focused on business value",
    useCaseEn: "Company profiles · Enterprise services · Brand stories",
    sampleTextEn: "From strategy to execution, reliable automation connects every part of the business and makes growth easier to understand.",
    azureVoiceZh: "zh-CN-YunyangNeural",
    azureVoiceEn: "en-US-DavisNeural",
    pitch: -3,
    directionZh: "Grounded Mandarin male corporate brand narration. Calm, credible and restrained, with clear emphasis on business value. Avoid dramatic monologue, documentary gravitas and exaggerated advertising tone.",
    directionEn: "Grounded English male brand narration. Calm, credible, and restrained, with clear emphasis on business value. Avoid theatrical documentary gravitas and exaggerated advertising tone."
  },
  {
    id: "male-documentary",
    label: "纪实叙事男声",
    shortLabel: "纪实男声",
    description: "成熟克制、叙事感强，信息密度高但不压迫",
    useCase: "纪录片 · 历史故事 · 工业纪实",
    sampleText: "沿着时间留下的线索，我们走进真实现场，理解每一次选择背后的原因，也看见改变如何一步步发生。",
    labelEn: "Documentary male",
    shortLabelEn: "Documentary",
    descriptionEn: "Measured, observant, and naturally narrative",
    useCaseEn: "Documentaries · History · Industrial stories",
    sampleTextEn: "Following the evidence left behind, we enter the real setting, understand each decision, and see how change unfolds over time.",
    azureVoiceZh: "zh-CN-YunjianNeural",
    azureVoiceEn: "en-US-ChristopherNeural",
    pitch: -2,
    directionZh: "Measured Mandarin male documentary narration. Observant, mature, and factual, with natural pauses and restrained emotion. Avoid news-anchor urgency and theatrical gravitas.",
    directionEn: "Measured English male documentary narration. Observant, mature, and factual, with natural pauses and restrained emotion. Avoid news-anchor urgency and theatrical gravitas."
  },
  {
    id: "male-youthful",
    label: "轻快青年男声",
    shortLabel: "青年男声",
    description: "年轻自然、节奏轻快，亲切但不过度兴奋",
    useCase: "社交短片 · 青年品牌 · 生活方式",
    sampleText: "今天换一种更轻松的方式出发，把复杂步骤变简单，让每个新想法都能更快落地。",
    labelEn: "Youthful male",
    shortLabelEn: "Youthful male",
    descriptionEn: "Young, relaxed, and upbeat without sounding overexcited",
    useCaseEn: "Social shorts · Youth brands · Lifestyle",
    sampleTextEn: "Today, take a lighter approach, make every complex step feel simple, and move each new idea forward with confidence.",
    azureVoiceZh: "zh-CN-YunfengNeural",
    azureVoiceEn: "en-US-EricNeural",
    pitch: 1,
    directionZh: "Youthful Mandarin male narration. Relaxed, conversational, and upbeat with crisp pacing. Avoid shouting, influencer exaggeration, and formal presentation cadence.",
    directionEn: "Youthful English male narration. Relaxed, conversational, and upbeat with crisp pacing. Avoid shouting, influencer exaggeration, and formal presentation cadence."
  },
  {
    id: "female-natural",
    label: "专业商务女声",
    shortLabel: "商务女声",
    description: "专业亲和、表达清楚，适合现代企业内容",
    useCase: "服务介绍 · 客户案例 · 品牌沟通",
    sampleText: "更简单的协作，更智能的流程，让每一次客户沟通都准确、自然，并且值得信赖。",
    labelEn: "Professional female",
    shortLabelEn: "Business female",
    descriptionEn: "Warm, professional, and easy to understand",
    useCaseEn: "Service intros · Customer stories · Brand communication",
    sampleTextEn: "Simpler collaboration and smarter workflows make every customer conversation clear, natural, and trustworthy.",
    azureVoiceZh: "zh-CN-XiaoxiaoNeural",
    azureVoiceEn: "en-US-JennyNeural",
    pitch: 0,
    directionZh: "Professional Mandarin female business explainer. Warm, articulate and composed, with a modern corporate presentation cadence. Avoid intimate monologue, audiobook and overly cheerful customer-service delivery.",
    directionEn: "Professional English female business explainer. Warm, articulate, and composed, with a modern presentation cadence. Avoid intimate audiobook delivery and overly cheerful customer-service delivery."
  },
  {
    id: "female-warm",
    label: "温暖亲和女声",
    shortLabel: "温暖女声",
    description: "柔和真诚、富有陪伴感，表达自然不做作",
    useCase: "家庭生活 · 健康服务 · 客户故事",
    sampleText: "每一次被认真倾听的需求，都值得一个更贴心的回答，让服务自然融入每天的生活。",
    labelEn: "Warm female",
    shortLabelEn: "Warm female",
    descriptionEn: "Warm, sincere, and reassuring without sounding sentimental",
    useCaseEn: "Family · Wellness · Customer stories",
    sampleTextEn: "Every need that is truly heard deserves a thoughtful answer, helping better service become a natural part of everyday life.",
    azureVoiceZh: "zh-CN-XiaoyiNeural",
    azureVoiceEn: "en-US-SaraNeural",
    pitch: 1,
    directionZh: "Warm Mandarin female narration. Sincere, reassuring, and conversational with gentle emphasis. Avoid sentimentality, whispering, and overly cheerful service tone.",
    directionEn: "Warm English female narration. Sincere, reassuring, and conversational with gentle emphasis. Avoid sentimentality, whispering, and overly cheerful service tone."
  },
  {
    id: "female-bright",
    label: "明亮活力女声",
    shortLabel: "活力女声",
    description: "明快清晰、富有感染力，适合抓住注意力",
    useCase: "新品发布 · 活动宣传 · 社交媒体",
    sampleText: "新的灵感已经就位，现在打开镜头，把亮点快速讲清楚，让更多人第一时间看见它。",
    labelEn: "Bright energetic female",
    shortLabelEn: "Bright female",
    descriptionEn: "Bright, engaging, and attention-grabbing with clear diction",
    useCaseEn: "Product launches · Campaigns · Social media",
    sampleTextEn: "The new idea is ready. Open the frame, make every highlight clear, and help more people notice it from the very first moment.",
    azureVoiceZh: "zh-CN-XiaohanNeural",
    azureVoiceEn: "en-US-NancyNeural",
    pitch: 2,
    directionZh: "Bright Mandarin female promotional narration. Engaging, crisp, and optimistic with controlled energy. Avoid shouting, cartoonish excitement, and hard-selling cadence.",
    directionEn: "Bright English female promotional narration. Engaging, crisp, and optimistic with controlled energy. Avoid shouting, cartoonish excitement, and hard-selling cadence."
  },
  {
    id: "female-calm",
    label: "舒缓讲解女声",
    shortLabel: "舒缓女声",
    description: "从容细腻、节奏舒适，适合循序渐进地解释",
    useCase: "课程讲解 · 操作指南 · 知识科普",
    sampleText: "先从最基础的一步开始，理解其中的关系，再按照清晰的顺序完成后面的每个环节。",
    labelEn: "Calm explainer female",
    shortLabelEn: "Calm female",
    descriptionEn: "Patient, composed, and easy to follow",
    useCaseEn: "Courses · How-to guides · Education",
    sampleTextEn: "Begin with the simplest step, understand how each part connects, and then follow the sequence through to a clear result.",
    azureVoiceZh: "zh-CN-XiaomoNeural",
    azureVoiceEn: "en-US-MichelleNeural",
    pitch: 0,
    directionZh: "Calm Mandarin female educational narration. Patient, composed, and easy to follow, with clear phrase boundaries. Avoid sleepy delivery, audiobook intimacy, and classroom lecturing.",
    directionEn: "Calm English female educational narration. Patient, composed, and easy to follow, with clear phrase boundaries. Avoid sleepy delivery, audiobook intimacy, and classroom lecturing."
  },
  {
    id: "female-authoritative",
    label: "权威新闻女声",
    shortLabel: "权威女声",
    description: "坚定准确、逻辑清楚，保持专业与可信度",
    useCase: "政策说明 · 金融资讯 · 正式公告",
    sampleText: "本次调整将分阶段执行，重点覆盖业务流程、风险控制与服务标准，所有变化都会明确记录。",
    labelEn: "Authoritative female",
    shortLabelEn: "Authority female",
    descriptionEn: "Firm, precise, and credible for formal information",
    useCaseEn: "Policy · Finance · Formal announcements",
    sampleTextEn: "The update will be introduced in stages, covering operations, risk controls, and service standards, with every change clearly documented.",
    azureVoiceZh: "zh-CN-XiaoruiNeural",
    azureVoiceEn: "en-US-ElizabethNeural",
    pitch: -1,
    directionZh: "Authoritative Mandarin female formal narration. Firm, precise, and credible with disciplined pacing. Avoid sensational newscasting, harshness, and bureaucratic monotony.",
    directionEn: "Authoritative English female formal narration. Firm, precise, and credible with disciplined pacing. Avoid sensational newscasting, harshness, and bureaucratic monotony."
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
  if (/纪录片|纪实|历史叙事|documentary|historical narrat/iu.test(request)) return "male-documentary";
  if (/青年男声|年轻男声|轻快男声|youthful male|young male/iu.test(request)) return "male-youthful";
  if (/权威女声|新闻女声|正式女声|authoritative female|news female/iu.test(request)) return "female-authoritative";
  if (/舒缓女声|讲解女声|教师女声|calm female|educational female/iu.test(request)) return "female-calm";
  if (/活力女声|明亮女声|明快女声|bright female|energetic female/iu.test(request)) return "female-bright";
  if (/温暖女声|亲和女声|柔和女声|warm female|friendly female/iu.test(request)) return "female-warm";
  if (/女声|女性|女生|female|woman/iu.test(request)) return "female-natural";
  if (/沉稳|稳重|成熟|低沉|权威|品牌男声|商务男声|deep|authoritative|mature|brand voice|business voice/iu.test(request)) return "male-deep";
  if (/男声|男性|男生|清晰|活力|male|man|clear|energetic/iu.test(request)) return "male-clear";
  return undefined;
}

export function narrationVoiceForBrief(request: string): NarrationVoice {
  const explicit = narrationVoiceFromRequest(request);
  if (explicit) return explicit;
  if (/纪录片|历史|工业纪实|真实事件|documentary|history|historical|industrial story/iu.test(request)) {
    return "male-documentary";
  }
  if (/课程|教程|科普|教学|老师|步骤讲解|education|course|tutorial|teacher|how-to|explainer/iu.test(request)) {
    return "female-calm";
  }
  if (/儿童|孩子|亲子|家庭|健康|温暖|陪伴|kids?|children|family|wellness|warm|caring/iu.test(request)) {
    return "female-warm";
  }
  if (/社交媒体|新品发布|活动宣传|短视频|美妆|social media|launch|campaign|short-form|beauty/iu.test(request)) {
    return "female-bright";
  }
  if (/金融|法律|治理|政务|企业级|权威|严肃|稳重|公司介绍|企业介绍|品牌介绍|企业服务|自动化公司|finance|legal|governance|enterprise|authoritative|serious|company profile|corporate profile|brand story/iu.test(request)) {
    return "male-deep";
  }
  if (/年轻|潮流|生活方式|旅行|轻松|youth|trendy|lifestyle|travel|casual/iu.test(request)) return "male-youthful";
  return DEFAULT_NARRATION_VOICE;
}
