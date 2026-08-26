function comparisonKey(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[\s，。！？；、,.!?;:'"“”‘’（）()《》【】\[\]-]/gu, "");
}

function splitNarration(text: string) {
  return text.match(/[^，。！？；、,.!?;]+[，。！？；、,.!?;]?/gu)
    ?.map((part) => part.trim())
    .filter(Boolean) ?? [];
}

const leadingMetaNarrationPatterns = [
  /^(?:这|本)(?:是)?(?:一)?(?:支|个|段)?关于.{1,24}的(?:视频|短片|影片)/u,
  /^(?:以下|接下来|现在)?(?:这|本)(?:是|将是|会是)?(?:一|这)?(?:支|个|段)?(?:关于.{0,24}的)?(?:视频|短片|影片)(?:将会?|会|主要|旨在|用于|通过)?(?:为您|向您)?(?:介绍|展示|呈现|讲述|带您了解|聚焦)/u,
  /^(?:在)?(?:这|本)(?:支|个|段)?(?:视频|短片|影片)(?:中|里)[，,:：]?/u,
  /^(?:(?:in|through)\s+)?this\s+(?:video|film|short)(?:\s+(?:is|will be))?(?:\s+(?:about|an? introduction to))?/iu,
  /^(?:here is|the following is)\s+an?\s+.{0,24}(?:video|film)/iu
];

function stripLeadingMetaNarration(text: string) {
  const parts = splitNarration(text);
  let removedMeta = false;
  while (parts.length > 0) {
    const leadingMeta = leadingMetaNarrationPatterns.some((pattern) => pattern.test(parts[0]));
    const metaContinuation = removedMeta && /^(?:(?:我们|我)(?:将|会|要)?(?:为您|向您)?(?:介绍|展示|呈现|讲述|带您了解)|we(?:'ll| will)?\s+(?:introduce|show|present|explain|explore))/iu.test(parts[0]);
    if (!leadingMeta && !metaContinuation) break;
    removedMeta = true;
    parts.shift();
  }
  return parts.join("").trim();
}

export function sanitizeNarrationForSpeech(text: string) {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (!normalized) return normalized;
  const audienceFacingNarration = stripLeadingMetaNarration(normalized);
  if (!audienceFacingNarration) return "";

  const kept: string[] = [];
  const seen = new Set<string>();
  let previousKey = "";
  for (const part of splitNarration(audienceFacingNarration)) {
    const key = comparisonKey(part);
    const repeatsPrevious = key.length >= 4
      && previousKey.length >= 4
      && (previousKey.endsWith(key) || key.endsWith(previousKey));
    if (!key || repeatsPrevious || (key.length >= 4 && seen.has(key))) continue;
    kept.push(part);
    if (key.length >= 4) {
      seen.add(key);
      previousKey = key;
    }
  }

  return kept
    .join("")
    .replace(/\s+([，。！？；、,.!?;])/gu, "$1")
    .replace(/([A-Za-z0-9][.!?])(?=[A-Z])/g, "$1 ")
    .trim() || audienceFacingNarration;
}
