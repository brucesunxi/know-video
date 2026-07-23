function jsonPayload(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? content;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  return (start >= 0 && end > start ? fenced.slice(start, end + 1) : fenced).trim();
}

function repairCommonJsonMistakes(payload: string) {
  return payload
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/("(?:\\.|[^"\\])*"|true|false|null|-?\d+(?:\.\d+)?|[}\]])(\s*\n\s*)(?="[^"\n]+"\s*:)/g, "$1,$2")
    .replace(/}(\s*\n\s*){/g, "},$1{");
}

export function parseModelJson(content: string) {
  const payload = jsonPayload(content);
  try {
    return JSON.parse(payload) as unknown;
  } catch (initialError) {
    const repaired = repairCommonJsonMistakes(payload);
    if (repaired === payload) throw initialError;
    return JSON.parse(repaired) as unknown;
  }
}
