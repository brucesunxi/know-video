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

export function parseImageSemanticMatch(payload: unknown) {
  const description = parseCloudflareVisionDescription(payload)?.toUpperCase();
  if (!description) return undefined;
  if (/\bSEMANTIC_MISMATCH\b/u.test(description)) return false;
  if (/\bSEMANTIC_MATCH\b/u.test(description)) return true;
  return undefined;
}

export function parseGeneratedImageInspection(payload: unknown) {
  const description = parseCloudflareVisionDescription(payload)?.toUpperCase();
  if (!description) return undefined;
  if (/\bTEXT_PRESENT\b/u.test(description)) return "text_present" as const;
  if (/\bSEMANTIC_MISMATCH\b/u.test(description)) return "semantic_mismatch" as const;
  if (/\bIMAGE_PASS\b/u.test(description)) return "pass" as const;
  return undefined;
}
