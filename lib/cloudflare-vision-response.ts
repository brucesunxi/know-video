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
  const description = parseCloudflareVisionDescription(payload)?.toUpperCase();
  if (!description) return undefined;
  if (/\bTEXT_PRESENT\b/u.test(description)) return true;
  if (/\bTEXT_FREE\b/u.test(description)) return false;
  return undefined;
}
