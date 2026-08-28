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
  locallyTrusted: boolean;
  descriptor: string;
};

const STOP_WORDS = new Set([
  "about", "after", "against", "around", "before", "behind", "camera", "cinematic", "close", "covering",
  "during", "from", "into", "introduction", "lighting", "scene", "shot", "style", "their", "there", "these",
  "this", "through", "video", "visual", "with", "without"
]);

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
  ["delivery", "inventory", "logistics", "package", "shipping"],
  ["apartment", "home", "house", "property", "real", "estate"],
  ["finance", "financial", "investment", "money"]
].map((group) => new Set(group));

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

function tokens(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, " ")
      .split(/\s+/u)
      .map(normalizedToken)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
  );
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
  candidate: StockCandidateDescription
): StockCandidateEvaluation {
  const descriptor = stockCandidateDescriptor(candidate);
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
  const queryTokens = tokens(candidate.query);
  const descriptorTokens = tokens(descriptor);
  const sceneTokens = tokens(sceneDescription);
  const exactMatches = [...queryTokens].filter((token) => descriptorTokens.has(token)).length;
  const semanticMatches = groupMatches(queryTokens, descriptorTokens);
  const sceneMatches = [...sceneTokens].filter((token) => descriptorTokens.has(token)).length;
  const relevanceScore = exactMatches * 5 + semanticMatches * 3 + Math.min(sceneMatches, 3);
  const safe = !unsafe;
  return {
    safe,
    safetyReason: unsafe?.reason,
    relevanceScore,
    exactMatches,
    semanticMatches,
    sceneMatches,
    locallyTrusted: safe && descriptor.length > 0 && (
      exactMatches >= 2
      || semanticMatches >= 2
      || sceneMatches >= 3
    ),
    descriptor
  };
}

export function rankStockCandidates<T extends StockCandidateDescription>(
  scene: Pick<Scene, "title" | "voiceover" | "visualPrompt" | "style">,
  candidates: T[],
  selectionKey = "default"
) {
  return candidates
    .map((candidate) => ({ candidate, evaluation: evaluateStockCandidate(scene, candidate) }))
    .filter(({ evaluation }) => evaluation.safe)
    .sort((left, right) => (
      right.evaluation.relevanceScore - left.evaluation.relevanceScore
      || right.evaluation.exactMatches - left.evaluation.exactMatches
      || stableHash(`${selectionKey}:${left.candidate.pageUrl}`) - stableHash(`${selectionKey}:${right.candidate.pageUrl}`)
    ));
}
