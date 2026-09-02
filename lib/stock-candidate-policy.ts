import type { Scene } from "@/lib/types";

export type StockCandidateDescription = {
  pageUrl: string;
  query: string;
  description?: string;
  tags?: string[];
};

export type StockCandidateEvaluation = {
  safe: boolean;
  safetyReason?: string;
  relevanceScore: number;
  exactMatches: number;
  semanticMatches: number;
  sceneMatches: number;
  narrativeMatches: number;
  contextMatches: number;
  locallyTrusted: boolean;
  descriptor: string;
};

const STOP_WORDS = new Set([
  "art", "background", "backdrop", "close", "design", "detail", "light", "material", "pattern", "space",
  "surface", "texture", "wall", "wallpaper",
  "about", "after", "against", "around", "before", "behind", "camera", "cinematic", "covering",
  "during", "from", "into", "introduction", "lighting", "scene", "shot", "style", "their", "there", "these",
  "this", "through", "video", "visual", "with", "without"
]);

const NON_NARRATIVE_DESCRIPTOR_TERMS = new Set([
  "abstract", "background", "backdrop", "bokeh", "fabric", "fractal", "grunge", "material", "particle",
  "pattern", "smoke", "surface", "texture", "wallpaper", "wool"
]);
const NON_NARRATIVE_REQUEST = /\b(?:abstract|background|backdrop|bokeh|fabric|fractal|material study|particles?|pattern|smoke|surface|textile|texture|wallpaper|wool)\b|抽象|背景素材|布料|材质|粒子|纹理|织物/iu;
const ORGANIC_MACRO_DESCRIPTOR_TERMS = new Set([
  "anatomy", "bacteria", "cell", "decay", "fungus", "guts", "larva", "microbe", "microscopic",
  "mold", "mucus", "organ", "parasite", "pore", "rotting", "skin", "slime", "tissue", "worm"
]);
const STRONG_ORGANIC_MACRO_DESCRIPTOR_TERMS = new Set([
  "guts", "larva", "microbe", "microscopic", "mucus", "parasite", "pore", "rotting", "slime", "worm"
]);
const ORGANIC_MACRO_REQUEST = /\b(?:anatomy|bacteria|biology|cell|dermatology|fungus|medical|microbe|microscopic|mold|organ|parasite|skin|tissue)\b|医学|生物|细胞|微生物|皮肤|组织|器官/iu;

const DARK_STORY_TERMS = /\b(?:crime|creepy|ghost|haunted|horror|nightmare|scary|spooky|suspense|terror|thriller|zombie)\b/iu;

const UNSAFE_VISUAL_PATTERNS: Array<{ pattern: RegExp; reason: string; allowForDarkStory?: boolean }> = [
  { pattern: /\b(?:blood|bloody|corpse|dead body|death|gore|murder|skull|skeleton)\b/iu, reason: "graphic or death imagery" },
  { pattern: /\b(?:attack|gun|knife|strangle|weapon)\b/iu, reason: "violent imagery" },
  { pattern: /\b(?:creepy|ghost|haunted|horror|nightmare|scary|spooky|terror|zombie)\b/iu, reason: "horror imagery", allowForDarkStory: true },
  { pattern: /\bsilhouett(?:e|ed)(?:\s+of)?\s+hands?\b|\b(?:shadow|shadowy) hands?\b/iu, reason: "threatening hand silhouette", allowForDarkStory: true },
  { pattern: /\bhands?\b.{0,32}\b(?:frosted|fogged|opaque) glass\b/iu, reason: "hands behind obscured glass", allowForDarkStory: true },
  { pattern: /\b(?:frosted|fogged|opaque) glass\b.{0,32}\bhands?\b/iu, reason: "hands behind obscured glass", allowForDarkStory: true },
  { pattern: /\brain(?:y|ing)? window\b.{0,48}\bnight\b/iu, reason: "ominous rainy-night window", allowForDarkStory: true },
  { pattern: /\bdark window\b.{0,48}\b(?:hand|silhouette)\b/iu, reason: "ominous window silhouette", allowForDarkStory: true }
];

const SEMANTIC_GROUPS = [
  ["business", "company", "corporate", "enterprise", "professional", "work"],
  ["client", "consumer", "customer", "prospect", "shopper"],
  ["colleague", "employee", "people", "staff", "team", "worker"],
  ["conference", "discussion", "meeting", "presentation", "talking"],
  ["office", "workplace", "workspace"],
  ["sale", "sales", "selling", "marketing"],
  ["success", "successful", "celebration", "happy", "satisfied"],
  ["book", "bookshelf", "library", "reader", "reading"],
  ["chef", "cooking", "dining", "food", "kitchen", "restaurant"],
  ["child", "children", "classroom", "kindergarten", "student", "teacher"],
  ["computer", "developer", "digital", "software", "technology"],
  ["doctor", "health", "hospital", "medical", "patient"],
  ["factory", "manufacturing", "production", "warehouse"],
  ["construction", "contractor", "hardhat", "helmet", "industrial", "jobsite", "ppe", "safety", "worksite"],
  ["delivery", "inventory", "logistics", "package", "shipping"],
  ["apartment", "home", "house", "property", "real", "estate"],
  ["finance", "financial", "investment", "money"],
  ["game", "gamer", "gaming", "gameplay", "player", "esports"],
  ["beach", "coast", "destination", "hotel", "ocean", "resort", "sea", "travel"]
].map((group) => new Set(group));

const CHINESE_SEMANTIC_TOKENS: Array<[RegExp, string[]]> = [
  [/企业|公司|商业|业务|职场|治理|审批|合规|风险/u, ["business", "company", "professional"]],
  [/销售|营销|客户|消费者|潜在客户/u, ["sales", "customer", "prospect"]],
  [/团队|员工|同事|人员/u, ["team", "employee", "people"]],
  [/办公室|工作场所|办公/u, ["office", "workplace"]],
  [/会议|讨论|演示|汇报/u, ["meeting", "discussion", "presentation"]],
  [/图书馆|书店|书架|阅读|读者|借阅/u, ["library", "book", "reader"]],
  [/餐厅|餐馆|饭店|厨房|厨师|美食|烹饪/u, ["restaurant", "kitchen", "food", "chef"]],
  [/学校|课堂|教育|课程|学生|教师|学习/u, ["classroom", "education", "student", "teacher"]],
  [/软件|科技|技术|电脑|编程|数字化/u, ["software", "technology", "computer"]],
  [/医院|医疗|医生|患者|健康/u, ["hospital", "medical", "doctor", "patient"]],
  [/工厂|制造|生产线/u, ["factory", "manufacturing", "production"]],
  [/工地|施工|安全帽|防护装备|入场检查|高空作业|作业安全/u, ["construction", "worker", "safety", "helmet", "ppe"]],
  [/仓库|库存|物流|包裹|配送/u, ["warehouse", "inventory", "logistics", "package"]],
  [/金融|银行|投资|资金/u, ["finance", "investment", "money"]],
  [/房产|住宅|公寓|楼盘/u, ["property", "apartment", "home"]],
  [/游戏|电竞|玩家|玩法/u, ["game", "gaming", "player"]],
  [/旅行|旅游|酒店|度假|海滩/u, ["travel", "hotel", "resort", "beach"]]
];

function stableHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizedToken(value: string) {
  if (value.length > 5 && value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  if (value.length > 5 && value.endsWith("ing")) return value.slice(0, -3);
  if (value.length > 4 && value.endsWith("ed")) return value.slice(0, -2);
  if (value.length > 4 && value.endsWith("s") && !value.endsWith("ss")) return value.slice(0, -1);
  return value;
}

function rawTokens(value: string) {
  return new Set(value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .split(/\s+/u)
    .map(normalizedToken)
    .filter((token) => token.length >= 3));
}

function tokens(value: string) {
  const result = new Set([...rawTokens(value)].filter((token) => !STOP_WORDS.has(token)));
  for (const [pattern, additions] of CHINESE_SEMANTIC_TOKENS) {
    if (!pattern.test(value)) continue;
    for (const addition of additions) result.add(normalizedToken(addition));
  }
  return result;
}

function overlapCount(left: Set<string>, right: Set<string>) {
  return [...left].filter((token) => right.has(token)).length;
}

function descriptorFromUrl(value: string) {
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter(Boolean);
    const slug = segments.reverse().find((segment) => !/^\d+$/u.test(segment)) ?? "";
    return decodeURIComponent(slug)
      .replace(/-\d+$/u, "")
      .replace(/[-_]+/gu, " ");
  } catch {
    return "";
  }
}

export function stockCandidateDescriptor(candidate: StockCandidateDescription) {
  return [
    candidate.description,
    ...(candidate.tags ?? []),
    descriptorFromUrl(candidate.pageUrl)
  ].filter(Boolean).join(" ").trim();
}

function groupMatches(left: Set<string>, right: Set<string>) {
  return SEMANTIC_GROUPS.filter((group) => (
    [...group].some((token) => left.has(normalizedToken(token)))
    && [...group].some((token) => right.has(normalizedToken(token)))
  )).length;
}

export function evaluateStockCandidate(
  scene: Pick<Scene, "title" | "voiceover" | "visualPrompt" | "style">,
  candidate: StockCandidateDescription,
  projectContext = ""
): StockCandidateEvaluation {
  const descriptor = stockCandidateDescriptor(candidate);
  const narrativeDescription = [scene.title, scene.voiceover].filter(Boolean).join(" ");
  const sceneDescription = [
    scene.title,
    scene.voiceover,
    scene.visualPrompt,
    scene.style.theme,
    scene.style.mood,
    scene.style.visualStyleLabel,
    scene.style.visualStylePrompt
  ].filter(Boolean).join(" ");
  const darkStoryRequested = DARK_STORY_TERMS.test(sceneDescription);
  const unsafe = UNSAFE_VISUAL_PATTERNS.find(({ pattern, allowForDarkStory }) => (
    pattern.test(descriptor) && !(darkStoryRequested && allowForDarkStory)
  ));
  const descriptorRawTokens = rawTokens(descriptor);
  const nonNarrativeMatches = overlapCount(descriptorRawTokens, NON_NARRATIVE_DESCRIPTOR_TERMS);
  const organicMacroMatches = overlapCount(descriptorRawTokens, ORGANIC_MACRO_DESCRIPTOR_TERMS);
  const strongOrganicMacroMatches = overlapCount(descriptorRawTokens, STRONG_ORGANIC_MACRO_DESCRIPTOR_TERMS);
  const safetyReason = unsafe?.reason
    ?? (nonNarrativeMatches >= 2 && !NON_NARRATIVE_REQUEST.test(narrativeDescription)
      ? "abstract texture or background footage"
      : undefined)
    ?? ((organicMacroMatches >= 2 || strongOrganicMacroMatches >= 1) && !ORGANIC_MACRO_REQUEST.test(narrativeDescription)
      ? "potentially disturbing organic macro imagery"
      : undefined);
  const queryTokens = tokens(candidate.query);
  const descriptorTokens = tokens(descriptor);
  const sceneTokens = tokens(sceneDescription);
  const narrativeTokens = tokens(narrativeDescription);
  const contextTokens = tokens(projectContext);
  const exactMatches = overlapCount(queryTokens, descriptorTokens);
  const semanticMatches = groupMatches(queryTokens, descriptorTokens);
  const sceneMatches = overlapCount(sceneTokens, descriptorTokens);
  const sceneSemanticMatches = groupMatches(sceneTokens, descriptorTokens);
  const narrativeMatches = overlapCount(narrativeTokens, descriptorTokens);
  const narrativeSemanticMatches = groupMatches(narrativeTokens, descriptorTokens);
  const contextMatches = overlapCount(contextTokens, descriptorTokens);
  const contextSemanticMatches = groupMatches(contextTokens, descriptorTokens);
  const relevanceScore = exactMatches * 5
    + semanticMatches * 3
    + Math.min(sceneMatches, 3)
    + narrativeMatches * 2
    + narrativeSemanticMatches * 3
    + Math.min(contextMatches, 3) * 2
    + contextSemanticMatches * 4;
  const safe = !safetyReason;
  const queryGrounded = exactMatches >= 2 || semanticMatches >= 2;
  const sceneGrounded = sceneMatches >= 2
    || sceneSemanticMatches >= 1
    || narrativeMatches >= 1
    || narrativeSemanticMatches >= 1;
  const contextGrounded = contextTokens.size === 0
    || contextMatches >= 1
    || contextSemanticMatches >= 1;
  return {
    safe,
    safetyReason,
    relevanceScore,
    exactMatches,
    semanticMatches,
    sceneMatches,
    narrativeMatches,
    contextMatches,
    locallyTrusted: safe && descriptor.length > 0 && queryGrounded && sceneGrounded && contextGrounded,
    descriptor
  };
}

export function rankStockCandidates<T extends StockCandidateDescription>(
  scene: Pick<Scene, "title" | "voiceover" | "visualPrompt" | "style">,
  candidates: T[],
  selectionKey = "default",
  projectContext = ""
) {
  return candidates
    .map((candidate) => ({ candidate, evaluation: evaluateStockCandidate(scene, candidate, projectContext) }))
    .filter(({ evaluation }) => evaluation.safe)
    .sort((left, right) => (
      right.evaluation.relevanceScore - left.evaluation.relevanceScore
      || right.evaluation.exactMatches - left.evaluation.exactMatches
      || stableHash(`${selectionKey}:${left.candidate.pageUrl}`) - stableHash(`${selectionKey}:${right.candidate.pageUrl}`)
    ));
}
