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
