const videoCreationProductPatterns = [
  /(?:AI\s*)?视频(?:生成|创作|制作)(?:平台|工具|软件|系统|工作室)/iu,
  /(?:文生视频|图生视频|对话改片|智能分镜)(?:平台|工具|软件|系统)?/iu,
  /(?:video generation|video creation|text-to-video|image-to-video|storyboard)(?:\s+(?:platform|tool|software|system|studio|editor|generator))/iu,
  /(?:AI\s+video|video)(?:\s+(?:platform|generator|creator|maker|editor))/iu
];

const productionInstructionPattern = /(?:生成|制作|创建|做|剪辑|输出|导出|改造|调整).{0,18}(?:视频|短片|宣传片|介绍片|分镜)|(?:时长|横屏|竖屏|画幅|配音|旁白|字幕|风格|节奏|镜头|分镜|秒钟?|minutes?|seconds?|aspect ratio)/iu;
const directProductionCommandPattern = /^(?:请|请帮|帮我|给我|需要|我想|想要|生成|制作|创建|做|剪辑|输出|导出|make|create|generate|produce|export)\s*.{0,24}(?:视频|短片|宣传片|介绍片|分镜|video|film|storyboard)/iu;
const productionSettingPattern = /^(?:视频)?(?:时长|长度|比例|画幅|横屏|竖屏|分辨率|格式|风格|节奏|语速|配音|旁白|字幕|场景数|镜头数|分镜数|duration|aspect ratio|resolution|format|style|pace|voice|captions?|scenes?|shots?)\s*(?:为|是|要|需要|:|：|=)?/iu;

const metaNarrationPatterns = [
  /(?:这|本|整)(?:支|个|段)?(?:视频|短片|影片).{0,16}(?:展示|呈现|介绍|讲述|带来|开始|结束|值得)/u,
  /(?:视频|画面|镜头|分镜).{0,14}(?:展示|呈现|聚焦|回到|切换|说明|介绍|生成|拆成|收束)/u,
  /(?:观众|viewer).{0,16}(?:继续看|看到|理解这支|keep watching)/iu,
  /(?:the|this)\s+(?:video|film|scene|shot).{0,18}(?:shows?|presents?|introduces?|frames?|returns?|opens?|closes?)/iu,
  /(?:camera|shot|scene|storyboard).{0,14}(?:shows?|presents?|explains?|moves?|cuts?|generated)/iu
];

const ignoredBrandTokens = new Set([
  "AI", "VIDEO", "SaaS", "APP", "WEB", "MP4", "HD", "4K", "B2B", "B2C"
]);

export type BriefDomain =
  | "gaming"
  | "education"
  | "commerce"
  | "entertainment"
  | "business"
  | "general";

const briefDomainPatterns: Array<[BriefDomain, RegExp]> = [
  [
    "gaming",
    /(?:游戏|玩家|玩法|关卡|角色|战斗|养成|副本|电竞|卡牌|开放世界|沙盒|解谜|闯关|gameplay|game|player|level|quest|battle|character)/iu
  ],
  [
    "education",
    /(?:教育|课程|课堂|老师|教师|学生|学习|教学|培训|知识|课件|education|course|classroom|teacher|student|learning|training)/iu
  ],
  [
    "commerce",
    /(?:电商|商品|购物|零售|店铺|库存|订单|物流|跨境|消费者|commerce|e-?commerce|retail|shop|store|inventory|order|logistics)/iu
  ],
  [
    "entertainment",
    /(?:娱乐|影视|电影|综艺|音乐|艺人|演出|内容创作|粉丝|audience|entertainment|film|music|artist|creator|fandom)|\bIP\b/iu
  ],
  [
    "business",
    /(?:企业|公司|团队|业务|客户|项目|治理|责任|授权|审批|风险|证据|协作|管理|平台|SaaS|B2B|enterprise|business|workflow|governance|approval|risk|accountability)/iu
  ]
];

export function detectBriefDomain(value: string): BriefDomain {
  for (const [domain, pattern] of briefDomainPatterns) {
    if (pattern.test(value)) return domain;
  }
  return "general";
}

export function isVideoCreationProductBrief(prompt: string) {
  return videoCreationProductPatterns.some((pattern) => pattern.test(prompt));
}

export function hasMetaProductionNarration(value: string) {
  return metaNarrationPatterns.some((pattern) => pattern.test(value));
}

export function isProductionInstructionClause(value: string) {
  const normalized = value.replace(/^[\s,，:：;；-]+|[\s,，:：;；-]+$/g, "").trim();
  if (!normalized) return true;
  if (directProductionCommandPattern.test(normalized) || productionSettingPattern.test(normalized)) return true;
  const hasFormatConstraint = /(?:\d{1,3}\s*(?:秒|秒钟|分钟|seconds?|minutes?)|16\s*:\s*9|9\s*:\s*16|横屏|竖屏|官网首屏|片长)/iu.test(normalized);
  const hasProductionNoun = /(?:视频|短片|宣传片|介绍片|分镜|镜头|video|film|storyboard|shot)/iu.test(normalized);
  return hasFormatConstraint || (productionInstructionPattern.test(normalized) && hasProductionNoun);
}

export function extractBriefSubject(prompt: string, chinese = true) {
  const latinCandidates = prompt.match(/\b[A-Z][A-Z0-9_-]{2,}\b/g) ?? [];
  const brand = latinCandidates.find((candidate) => !ignoredBrandTokens.has(candidate));
  if (brand) return brand;

  const directedSubject = prompt.match(/(?:为|给|关于)\s*([^，。；：:\n]{2,28}?)(?:制作|生成|创建|做一|打造)/u)?.[1]
    ?.replace(/^(?:一家|一个|这家|这个)/u, "")
    .trim();
  if (directedSubject) return directedSubject;

  const firstClause = prompt.split(/[。！？；\n]/u)
    .map((part) => part.trim())
    .find((part) => part.length >= 2 && !productionInstructionPattern.test(part));
  if (firstClause) return firstClause.replace(/^[请帮我给为关于\s]+/u, "").slice(0, chinese ? 18 : 48);
  return chinese ? "这项产品" : "This product";
}

export function extractBriefFacts(prompt: string, chinese = true) {
  const sentenceParts = prompt
    .replace(/\r/g, "")
    .split(/[。！？；\n]+/u)
    .map((part) => part.replace(/^[\s,，:：-]+|[\s,，:：-]+$/g, "").trim())
    .filter(Boolean);
  const parts = sentenceParts.flatMap((part) => {
    if (!isProductionInstructionClause(part)) return [part];
    return part.split(/[,，:：、]+/u).map((clause) => clause.trim()).filter(Boolean);
  }).filter((part) => part.length >= (chinese ? 6 : 16))
    .filter((part) => !isProductionInstructionClause(part))
    .filter((part) => !(productionInstructionPattern.test(part) && part.length < (chinese ? 28 : 72)));

  const unique: string[] = [];
  for (const part of parts) {
    const compact = part.replace(/\s+/g, " ");
    if (!unique.some((existing) => existing.includes(compact) || compact.includes(existing))) unique.push(compact);
  }
  return unique.slice(0, 8);
}

const visualConceptPatterns: Array<[RegExp, string, string]> = [
  [/\bGates?\b|Gate\s*记录|闸门|阶段门/iu, "Gate checkpoints", "多道 Gate 检查点"],
  [/证据包|证据|evidence|audit/iu, "evidence packets", "可审查证据包"],
  [/可追溯|追溯|traceable|traceability|记录/iu, "traceable record trail", "可追溯记录链"],
  [/责任|accountability|ownership|owner/iu, "accountability chain", "责任链路"],
  [/风险|risk|signal|信号/iu, "risk signal map", "风险信号地图"],
  [/授权|approval|approve|permission/iu, "approval gates", "授权节点"],
  [/治理|governance/iu, "governance control room", "治理控制室"],
  [/预算|budget|cost/iu, "budget boundary", "预算边界"],
  [/阵容|候选|casting|talent/iu, "candidate lineup board", "候选阵容板"],
  [/沙盘|推演|simulation/iu, "scenario simulation table", "沙盘推演桌"],
  [/反馈|舆情|audience|sentiment/iu, "audience feedback radar", "受众反馈雷达"],
  [/上线|发布|launch|release/iu, "launch readiness gate", "上线准备门"]
];

export function extractBriefVisualConcepts(prompt: string, chinese = true) {
  const concepts: string[] = [];
  if (detectBriefDomain(prompt) === "gaming") {
    const gamingConceptPatterns: Array<[RegExp, string, string]> = [
      [/玩法|gameplay/iu, "core gameplay action", "核心玩法动作"],
      [/玩家|player/iu, "player-controlled action", "玩家操控动作"],
      [/关卡|副本|level|quest|dungeon/iu, "playable level objective", "可游玩关卡目标"],
      [/角色|character|hero/iu, "recognizable game character", "可识别游戏角色"],
      [/战斗|battle|combat/iu, "combat encounter", "战斗遭遇"],
      [/建造|合成|crafting|build(?:ing)?/iu, "crafting or building interaction", "建造与制作交互"],
      [/解谜|puzzle/iu, "puzzle interaction", "解谜交互"],
      [/养成|成长|progression|upgrade/iu, "progression and upgrade", "成长与升级反馈"]
    ];
    for (const [pattern, english, localized] of gamingConceptPatterns) {
      if (pattern.test(prompt)) concepts.push(chinese ? localized : english);
    }
  }
  for (const [pattern, english, localized] of visualConceptPatterns) {
    if (pattern.test(prompt)) concepts.push(chinese ? localized : english);
  }
  const latinTerms = prompt.match(/\b[A-Z][A-Za-z0-9_-]{2,}\b/g) ?? [];
  for (const term of latinTerms) {
    if (!ignoredBrandTokens.has(term.toUpperCase()) && !concepts.includes(term)) concepts.unshift(term);
  }
  return concepts.filter((concept, index, values) => values.indexOf(concept) === index).slice(0, 8);
}
