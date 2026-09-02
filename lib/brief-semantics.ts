const videoCreationProductPatterns = [
  /(?:AI\s*)?视频(?:生成|创作|制作)(?:平台|工具|软件|系统|工作室)/iu,
  /(?:文生视频|图生视频|对话改片|智能分镜)(?:平台|工具|软件|系统)?/iu,
  /(?:video[\s-]*generation|video[\s-]*creation|text-to-video|image-to-video|storyboard)(?:\s+(?:platform|tool|software|system|studio|editor|generator))/iu,
  /(?:AI\s+video|video)(?:\s+(?:platform|generator|creator|maker|editor))/iu
];

const productionInstructionPattern = /(?:生成|制作|创建|做|剪辑|输出|导出|改造|调整).{0,18}(?:视频|短片|宣传片|介绍片|分镜)|(?:时长|横屏|竖屏|画幅|配音|旁白|字幕|风格|节奏|镜头|分镜|秒钟?|minutes?|seconds?|aspect ratio)/iu;
const directProductionCommandPattern = /^(?:请|请帮|帮我|给我|需要|我想|想要|生成|制作|创建|做|剪辑|输出|导出|make|create|generate|produce|export)\s*.{0,24}(?:视频|短片|宣传片|介绍片|分镜|video|film|storyboard)/iu;
const productionSettingPattern = /^(?:视频)?(?:时长|长度|比例|画幅|横屏|竖屏|分辨率|格式|风格|节奏|语速|配音|旁白|字幕|场景数|镜头数|分镜数|duration|aspect ratio|resolution|format|style|pace|voice|captions?|scenes?|shots?)\s*(?:为|是|要|需要|:|：|=)?/iu;

const metaNarrationPatterns = [
  /^(?:这|本)(?:是)?(?:一)?(?:支|个|段)?关于.{1,24}的(?:视频|短片|影片)/u,
  /^(?:以下|接下来|现在)?(?:这|本)(?:是|将是|会是)?(?:一|这)?(?:支|个|段)?(?:关于.{0,24}的)?(?:视频|短片|影片)(?:将会?|会|主要|旨在|用于|通过)?(?:为您|向您)?(?:介绍|展示|呈现|讲述|带您了解|聚焦)/u,
  /^(?:在)?(?:这|本)(?:支|个|段)?(?:视频|短片|影片)(?:中|里)[，,:：]?/u,
  /(?:这|本|整)(?:支|个|段)?(?:视频|短片|影片).{0,16}(?:展示|呈现|介绍|讲述|带来|开始|结束|值得)/u,
  /(?:视频|画面|镜头|分镜).{0,14}(?:展示|呈现|聚焦|回到|切换|说明|介绍|生成|拆成|收束)/u,
  /(?:观众|viewer).{0,16}(?:继续看|看到|理解这支|keep watching)/iu,
  /(?:the|this)\s+(?:video|film|scene|shot).{0,18}(?:shows?|presents?|introduces?|frames?|returns?|opens?|closes?)/iu,
  /^(?:(?:in|through)\s+)?this\s+(?:video|film|short)(?:\s+(?:is|will be))?(?:\s+(?:about|an? introduction to))?|^(?:here is|the following is)\s+an?\s+.{0,24}(?:video|film)/iu,
  /(?:camera|shot|scene|storyboard).{0,14}(?:shows?|presents?|explains?|moves?|cuts?|generated)/iu
];

const ignoredBrandTokens = new Set([
  "AI", "API", "APP", "B2B", "B2C", "CEO", "CFO", "CRM", "CTA", "ERP", "FAQ", "GPU", "HD", "HR",
  "JPG", "KPI", "LLM", "MP4", "PDF", "PNG", "ROI", "SaaS", "SDK", "SEO", "TTS", "UI", "URL", "UX", "VIDEO", "WEB", "4K"
]);

const genericEnglishNamePattern = /^(?:sales|marketing|promotional?|introduction|introductory|product|service|solution|platform|company|business|prospects?|customers?|clients?|teams?|video|film)(?:\s+(?:sales|marketing|promotional?|introduction|introductory|product|service|solution|platform|company|business|prospects?|customers?|clients?|teams?|video|film))*$/iu;

export type BriefDomain =
  | "gaming"
  | "education"
  | "commerce"
  | "hospitality"
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
    "hospitality",
    /(?:餐馆|餐厅|饭店|酒楼|咖啡店|咖啡馆|酒店|旅馆|民宿|菜品|厨师|用餐|餐饮|restaurant|cafe|coffee shop|hotel|hospitality|dining|cuisine|chef)/iu
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
  const videoCreationProduct = prompt.match(
    /\b((?:AI\s+)?video[\s-]*(?:generation|creation|editing|maker|editor|production)\s+(?:platform|tool|software|system|studio|generator|editor)|(?:text-to-video|image-to-video|storyboard)\s+(?:platform|tool|software|system|studio|generator|editor))\b/iu
  )?.[1]?.replace(/\s+/g, " ").trim();
  if (videoCreationProduct) {
    return chinese && /\p{Script=Han}/u.test(prompt) ? "AI 视频生成平台" : videoCreationProduct;
  }

  const latinCandidates = prompt.match(/\b[A-Z][A-Z0-9_-]{2,}\b/g) ?? [];
  const brand = latinCandidates.find((candidate) => !ignoredBrandTokens.has(candidate));
  if (brand) return brand;

  const directedSubject = prompt.match(/(?:为|给|关于)\s*([^，。；：:\n]{2,28}?)(?:制作|生成|创建|做一|打造)/u)?.[1]
    ?.replace(/^(?:一家|一个|这家|这个)/u, "")
    .trim();
  if (directedSubject) return directedSubject;

  const commandedChineseSubject = prompt.match(
    /(?:生成|制作|创建|做|拍)(?:一(?:个|家|款|所|间|门|部|支|段))?\s*([^，。；：:\n]{2,24}?)(?:的)?(?:宣传|介绍|推广|招生|品牌)?(?:视频|短片|宣传片|介绍片)/u
  )?.[1]?.trim();
  if (commandedChineseSubject) return commandedChineseSubject;

  const englishSubject = prompt.match(
    /(?:make|create|generate|produce)\s+(?:an?\s+)?(.{2,48}?)\s+(?:promotional|promotion|introductory|introduction|marketing|brand)?\s*(?:video|film)|(?:video|film)\s+(?:for|about)\s+(?:an?\s+)?([^,.!?;\n]{2,48})/iu
  );
  const commandedEnglishSubject = (englishSubject?.[1] ?? englishSubject?.[2])
    ?.replace(/^(?:for|about)\s+/iu, "")
    .trim();
  if (commandedEnglishSubject) return commandedEnglishSubject;

  const firstClause = prompt.split(/[。！？；\n]/u)
    .map((part) => part.trim())
    .find((part) => part.length >= 2 && !productionInstructionPattern.test(part));
  if (firstClause) return firstClause.replace(/^[请帮我给为关于\s]+/u, "").slice(0, chinese ? 18 : 48);
  return chinese ? "这项产品" : "This product";
}

export function requiredNamedBriefSubject(prompt: string, chinese = true) {
  const uppercaseCandidates = prompt.match(/\b[A-Z][A-Z0-9_-]{2,}\b/g) ?? [];
  const uppercaseName = uppercaseCandidates.find((candidate) => !ignoredBrandTokens.has(candidate));
  if (uppercaseName) return uppercaseName;

  const declaredEnglishName = prompt.match(
    /\b([A-Z][A-Za-z0-9&._-]*(?:\s+[A-Z][A-Za-z0-9&._-]*){0,3})\s+(?:is|helps|offers|provides|builds|creates|serves)\b/u
  )?.[1]?.trim();
  if (declaredEnglishName && !genericEnglishNamePattern.test(declaredEnglishName)) return declaredEnglishName;

  const directedEnglishName = prompt.match(
    /(?:for|about)\s+([A-Z][A-Za-z0-9&._-]*(?:\s+[A-Z][A-Za-z0-9&._-]*){0,3})(?=\s*(?:[,.;:]|\bthat\b|\bwhich\b|\bto\b|$))/u
  )?.[1]?.trim();
  if (directedEnglishName && !genericEnglishNamePattern.test(directedEnglishName)) return directedEnglishName;

  if (!chinese) return undefined;
  const legalEntityName = prompt.match(
    /(?:为|给|关于|公司(?:是|名为)?|品牌(?:是|名为)?|^|[，。；！？\n])\s*([\p{Script=Han}A-Za-z0-9·&]{2,32}?(?:有限责任公司|股份有限公司|有限公司|集团))/u
  )?.[1]?.trim();
  return legalEntityName?.replace(/^(?:请(?:帮我)?|帮我)?(?:为|给|关于)/u, "").trim();
}

export function briefOutputIncludesRequiredName(output: string, prompt: string, chinese = true) {
  const requiredName = requiredNamedBriefSubject(prompt, chinese);
  if (!requiredName) return true;
  return compactTitleValue(output).includes(compactTitleValue(requiredName));
}

function compactTitleValue(value: string) {
  return value
    .toLowerCase()
    .replace(/[\s，。！？；,.!?;:：、\-_"'“”‘’()（）]/g, "");
}

function subjectTokens(value: string) {
  const latin = value.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length >= 3) ?? [];
  const han = (value.match(/\p{Script=Han}+/gu) ?? []).flatMap((part) => {
    const characters = Array.from(part);
    return characters.length <= 2
      ? [part]
      : characters.slice(0, -1).map((character, index) => `${character}${characters[index + 1]}`);
  });
  return [...latin, ...han];
}

const subjectTranslations: Array<[RegExp, string, string]> = [
  [/幼儿园/u, "幼儿园", "kindergarten"],
  [/托儿所|托育/u, "托育中心", "childcare center"],
  [/学校/u, "学校", "school"],
  [/课程/u, "课程", "course"],
  [/咖啡店|咖啡馆/u, "咖啡店", "coffee shop"],
  [/餐馆|餐厅|饭店|酒楼/u, "餐厅", "restaurant"],
  [/酒店|旅馆/u, "酒店", "hotel"],
  [/公司|企业/u, "公司", "company"],
  [/产品/u, "产品", "product"],
  [/游戏/u, "游戏", "game"]
];

const visualStyleTitlePattern = /(?:纸艺|拼贴|纸乐园|纸世界|像素|漫画|黑板|粉笔|线稿|简笔|等距|电影感|电影纪实|写实|paper\s*(?:art|collage|cut)|collage|pixel|comic|chalkboard|line\s*art|isometric|cinematic|realistic)/iu;

function translatedSubject(subject: string, chinese: boolean) {
  const translation = subjectTranslations.find(([pattern]) => pattern.test(subject));
  if (!translation) return subject;
  return chinese ? translation[1] : translation[2];
}

export function localizedBriefSubject(prompt: string, chinese = true) {
  const subject = extractBriefSubject(prompt, chinese);
  const localized = translatedSubject(subject, chinese);
  if (chinese || !/\p{Script=Han}/u.test(localized)) return localized;

  const domainFallbacks: Record<BriefDomain, string> = {
    gaming: "game",
    education: "learning experience",
    commerce: "customer offering",
    hospitality: "hospitality experience",
    entertainment: "entertainment experience",
    business: "business offering",
    general: "featured experience"
  };
  return domainFallbacks[detectBriefDomain(prompt)];
}

export function projectTitleRepresentsBrief(title: string, prompt: string, chinese = true) {
  const subject = extractBriefSubject(prompt, chinese);
  const compactSubject = compactTitleValue(subject);
  if (["这项产品", "这个产品", "thisproduct", "theproduct"].includes(compactSubject)) return true;

  const compactTitle = compactTitleValue(title);
  if (!compactTitle) return false;
  if (compactTitle.includes(compactSubject) || compactSubject.includes(compactTitle)) return true;
  const localizedSubject = translatedSubject(subject, chinese);
  const compactLocalizedSubject = compactTitleValue(localizedSubject);
  if (compactTitle.includes(compactLocalizedSubject) || compactLocalizedSubject.includes(compactTitle)) return true;
  return subjectTokens(`${subject} ${localizedSubject}`).some((token) => compactTitle.includes(compactTitleValue(token)));
}

export function ensureBriefFaithfulProjectTitle(candidate: string, prompt: string, chinese = true) {
  const title = candidate.trim();
  if (title && projectTitleRepresentsBrief(title, prompt, chinese)) return title;

  const subject = extractBriefSubject(prompt, chinese);
  const compactSubject = compactTitleValue(subject);
  if (["这项产品", "这个产品", "thisproduct", "theproduct"].includes(compactSubject)) return title;
  const localizedSubject = translatedSubject(subject, chinese);
  if (chinese) return /宣传|推广|招生/u.test(prompt) ? `${localizedSubject}宣传片` : `${localizedSubject}介绍`;

  const readableSubject = localizedSubject.replace(/\s+/g, " ").trim();
  return `${readableSubject.charAt(0).toUpperCase()}${readableSubject.slice(1)} Introduction`;
}

export function projectTitleMistakesStyleForSubject(title: string, prompt: string, chinese = true) {
  return !projectTitleRepresentsBrief(title, prompt, chinese)
    && visualStyleTitlePattern.test(title)
    && !visualStyleTitlePattern.test(prompt);
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
  if (detectBriefDomain(prompt) === "commerce") {
    const commerceConceptPatterns: Array<[RegExp, string, string]> = [
      [/跨境|cross[- ]?border|海外/iu, "cross-border warehouse route", "跨境仓网路线"],
      [/库存|inventory|stock/iu, "multi-warehouse inventory balance", "多仓库存平衡"],
      [/仓库|仓储|warehouse|fulfillment/iu, "recognizable warehouse nodes and shelving", "可识别仓库节点与货架"],
      [/订单|order/iu, "order flow through fulfillment stages", "订单履约流"],
      [/物流|运输|配送|logistics|shipping|delivery/iu, "parcel and container logistics route", "包裹与集装箱物流路线"],
      [/缺货|断货|低库存|滞销|积压|补货|out[- ]?of[- ]?stock|low stock|overstock|replenish/iu, "stock imbalance and replenishment signal", "库存失衡与补货信号"],
      [/调拨|transfer|allocation/iu, "warehouse transfer path", "仓间调拨路径"]
    ];
    for (const [pattern, english, localized] of commerceConceptPatterns) {
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
