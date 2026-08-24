type VisionResponse = {
  answer?: unknown;
  caption?: unknown;
  description?: unknown;
  result?: unknown;
};

function cleanDescription(value: unknown) {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 1600) : undefined;
}

function normalizedVerdict(payload: unknown) {
  return parseCloudflareVisionDescription(payload)
    ?.toUpperCase()
    .replace(/[^A-Z]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function parseCloudflareVisionDescription(payload: unknown) {
  let current = payload;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    const response = current as VisionResponse;
    const description = cleanDescription(response.answer)
      || cleanDescription(response.caption)
      || cleanDescription(response.description);
    if (description) return description;
    if (!response.result || response.result === current) return undefined;
    current = response.result;
  }
  return undefined;
}

export function parseImageTextPresence(payload: unknown) {
  const description = normalizedVerdict(payload);
  if (!description) return undefined;
  if (/(?:^|_)TEXT_FREE(?:_|$)/u.test(description)
    || /(?:^|_)NO_(?:VISIBLE_)?TEXT(?:_|$)/u.test(description)
    || /(?:^|_)NO_TEXT_(?:IS_)?PRESENT(?:_|$)/u.test(description)) return false;
  if (/(?:^|_)TEXT_PRESENT(?:_|$)/u.test(description) || /(?:^|_)TEXT_DETECTED(?:_|$)/u.test(description)) return true;
  return undefined;
}

export function parseImageSemanticMatch(payload: unknown) {
  const description = normalizedVerdict(payload);
  if (!description) return undefined;
  if (/(?:^|_)SEMANTIC_MISMATCH(?:_|$)/u.test(description)) return false;
  if (/(?:^|_)SEMANTIC_MATCH(?:_|$)/u.test(description)) return true;
  return undefined;
}

export function parseGeneratedImageInspection(payload: unknown) {
  const description = normalizedVerdict(payload);
  if (!description) return undefined;
  if (/(?:^|_)TEXT_PRESENT(?:_|$)/u.test(description)) return "text_present" as const;
  if (/(?:^|_)STYLE_MISMATCH(?:_|$)/u.test(description)) return "style_mismatch" as const;
  if (/(?:^|_)SEMANTIC_MISMATCH(?:_|$)/u.test(description)) return "semantic_mismatch" as const;
  if (/(?:^|_)IMAGE_PASS(?:_|$)/u.test(description) || /(?:^|_)IMAGE_PASSES(?:_|$)/u.test(description)) return "pass" as const;
  return undefined;
}
