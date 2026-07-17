import type { Scene } from "@/lib/types";

function hasCjk(text: string) {
  return /\p{Script=Han}/u.test(text);
}

function splitLongCue(text: string) {
  if (hasCjk(text)) {
    const maxLength = 15;
    if (text.length <= maxLength) return [text];
    const chunks: string[] = [];
    let rest = text;
    while (rest.length > maxLength) {
      const cut = preferredChineseCueBreak(rest, maxLength);
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    if (rest) chunks.push(rest);
    return chunks;
  }

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 8) return [text];
  const chunks: string[] = [];
  for (let index = 0; index < words.length; index += 8) {
    chunks.push(words.slice(index, index + 8).join(" "));
  }
  return chunks;
}

function preferredChineseCueBreak(text: string, maxLength: number) {
  const windowStart = Math.max(6, Math.floor(maxLength * 0.56));
  const punctuation = /[，。！？；,.!?;]/u;
  const badNextStart = /[格性化们]/u;
  for (let index = maxLength; index >= windowStart; index -= 1) {
    if (punctuation.test(text[index - 1] ?? "")) return index;
  }

  const softBefore = /[的了和与及为在从向把被将对就而或、频产]/u;
  for (let index = windowStart; index <= maxLength; index += 1) {
    const current = text[index - 1] ?? "";
    const next = text[index] ?? "";
    if (softBefore.test(current) && !punctuation.test(next) && !badNextStart.test(next)) return index;
  }

  const softAfter = /[但并让使需能会可]/u;
  for (let index = windowStart; index <= maxLength; index += 1) {
    if (softAfter.test(text[index] ?? "")) return index;
  }

  for (let index = maxLength; index >= windowStart; index -= 1) {
    if (!badNextStart.test(text[index] ?? "")) return index;
  }

  return maxLength;
}

export function narrationCaptionCues(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const sentences = normalized.match(/[^，。！？；,.!?]+[，。！？；,.!?]?/g)
    ?.map((part) => part.trim())
    .filter(Boolean) ?? [normalized];
  return sentences.flatMap(splitLongCue).filter(Boolean);
}

function cueWeight(text: string) {
  const hanCharacters = (text.match(/\p{Script=Han}/gu) ?? []).length;
  const latinWords = (text.match(/[A-Za-z0-9]+/g) ?? []).length;
  const punctuation = (text.match(/[，。！？；,.!?;]/g) ?? []).length;
  return Math.max(0.35, hanCharacters / 4.15 + latinWords / 2.7 + punctuation * 0.16);
}

export function narrationDurationInFrames(
  scene: Pick<Scene, "assets">,
  fps: number,
  playbackRate: number,
  contentDurationInFrames: number
) {
  const audio = scene.assets.find((asset) => asset.type === "audio" && asset.url);
  const actualDurationSeconds = Number(audio?.metadata?.actualDurationSeconds);
  if (!audio || !Number.isFinite(actualDurationSeconds) || actualDurationSeconds <= 0) {
    return audio ? contentDurationInFrames : 0;
  }
  return Math.min(
    contentDurationInFrames,
    Math.max(1, Math.round((actualDurationSeconds * fps) / Math.max(0.1, playbackRate)))
  );
}

export function activeNarrationCaption(text: string, frame: number, narrationDurationInFrames: number) {
  const cues = narrationCaptionCues(text);
  if (cues.length === 0 || narrationDurationInFrames <= 0 || frame < 0 || frame >= narrationDurationInFrames) {
    return undefined;
  }
  const weights = cues.map(cueWeight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const position = (frame / Math.max(1, narrationDurationInFrames)) * totalWeight;
  let cursor = 0;
  for (const [index, cue] of cues.entries()) {
    const startWeight = cursor;
    cursor += weights[index];
    if (position < cursor || index === cues.length - 1) {
      return {
        text: cue,
        index,
        startFrame: Math.round((startWeight / totalWeight) * narrationDurationInFrames),
        endFrame: Math.max(1, Math.round((cursor / totalWeight) * narrationDurationInFrames))
      };
    }
  }
  return undefined;
}
