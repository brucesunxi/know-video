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

export function sanitizeNarrationForSpeech(text: string) {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (!normalized) return normalized;

  const kept: string[] = [];
  const seen = new Set<string>();
  let previousKey = "";
  for (const part of splitNarration(normalized)) {
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
    .trim() || normalized;
}
