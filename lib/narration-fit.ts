import { estimateNarrationSeconds } from "@/lib/speech-timing";
import type { Scene } from "@/lib/types";

function hasChinese(text: string) {
  return /\p{Script=Han}/u.test(text);
}

function narrationBudget(durationSeconds: number, chinese: boolean) {
  const availableSeconds = Math.max(1.3, durationSeconds - 0.45);
  return chinese
    ? Math.max(4, Math.floor(availableSeconds * 4.05))
    : Math.max(3, Math.floor(availableSeconds * 2.55));
}

function trimChineseNarration(text: string, durationSeconds: number) {
  const normalized = text.replace(/\s+/g, "").trim();
  const budget = narrationBudget(durationSeconds, true);
  if (normalized.replace(/[，。！？；、]/g, "").length <= budget) return normalized;

  const sentenceParts = normalized.match(/[^。！？；]+[。！？；]?/gu)?.map((part) => part.trim()).filter(Boolean) ?? [normalized];
  let candidate = "";
  for (const part of sentenceParts) {
    const next = `${candidate}${part}`;
    if (next.replace(/[，。！？；、]/g, "").length > budget) break;
    candidate = next;
  }
  if (candidate.replace(/[，。！？；、]/g, "").length >= Math.max(4, Math.floor(budget * 0.56))) {
    return /[。！？；]$/u.test(candidate) ? candidate : `${candidate}。`;
  }

  const clause = normalized.split(/[，。！？；]/u)[0]?.trim();
  if (clause && clause.length <= budget) return `${clause}。`;
  return `${normalized.replace(/[，。！？；、]/g, "").slice(0, budget)}。`;
}

function trimEnglishNarration(text: string, durationSeconds: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const budget = narrationBudget(durationSeconds, false);
  const words = normalized.replace(/[,.!?;:]/g, "").split(/\s+/).filter(Boolean);
  if (words.length <= budget) return normalized;

  const sentences = normalized.match(/[^.!?;]+[.!?;]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [normalized];
  const kept: string[] = [];
  let wordCount = 0;
  for (const sentence of sentences) {
    const sentenceWords = sentence.replace(/[,.!?;:]/g, "").split(/\s+/).filter(Boolean);
    if (wordCount + sentenceWords.length > budget) break;
    kept.push(sentence);
    wordCount += sentenceWords.length;
  }
  if (wordCount >= Math.max(3, Math.floor(budget * 0.55))) {
    const joined = kept.join(" ");
    return /[.!?]$/.test(joined) ? joined : `${joined}.`;
  }
  return `${words.slice(0, budget).join(" ")}.`;
}

export function fitNarrationToDuration(text: string, durationSeconds: number) {
  return hasChinese(text)
    ? trimChineseNarration(text, durationSeconds)
    : trimEnglishNarration(text, durationSeconds);
}

export function narrationComfortIssue(text: string, durationSeconds: number) {
  const estimate = estimateNarrationSeconds(text);
  const available = Math.max(1, durationSeconds - 0.25);
  if (estimate > available * 1.08) return "too-long";
  const chinese = hasChinese(text);
  const hanCharacters = (text.match(/\p{Script=Han}/gu) ?? []).length;
  const latinWords = (text.match(/[A-Za-z0-9]+/g) ?? []).length;
  const minimum = chinese
    ? Math.max(4, Math.floor(durationSeconds * 1.9))
    : Math.max(3, Math.floor(durationSeconds * 1.05));
  if ((chinese ? hanCharacters : latinWords) < minimum) return "too-short";
  return undefined;
}

export function fitSceneNarration(scene: Scene): Scene {
  const fitted = fitNarrationToDuration(scene.voiceover, scene.durationSeconds);
  return fitted === scene.voiceover ? scene : { ...scene, voiceover: fitted };
}

export function fitScenesNarration(
  scenes: Scene[],
  targetDuration: number,
  options: { preserveNarration?: boolean } = {}
) {
  if (scenes.length === 0) return scenes;
  if (options.preserveNarration) {
    const durations = scenes.map((scene) => Math.max(2, Math.ceil(estimateNarrationSeconds(scene.voiceover) + 0.45)));
    let remaining = targetDuration - durations.reduce((sum, value) => sum + value, 0);
    if (remaining < 0) {
      // Keep the AI treatment and compact complete spoken clauses instead of
      // discarding the whole industry-specific storyboard for a generic fallback.
      return fitScenesNarration(scenes, targetDuration);
    }
    let cursor = 0;
    while (remaining > 0) {
      durations[cursor % durations.length] += 1;
      remaining -= 1;
      cursor += 1;
    }
    return scenes.map((scene, index) => ({ ...scene, durationSeconds: durations[index] }));
  }
  const desired = scenes.map((scene) => {
    const estimated = estimateNarrationSeconds(scene.voiceover);
    return Math.max(2, Math.min(20, Math.round(Math.max(scene.durationSeconds, estimated + 0.65))));
  });
  const total = desired.reduce((sum, value) => sum + value, 0) || scenes.length;
  const durations = desired.map((value) => Math.max(2, Math.min(20, Math.round((value / total) * targetDuration))));
  let difference = targetDuration - durations.reduce((sum, value) => sum + value, 0);
  let cursor = 0;
  while (difference !== 0 && cursor < 500) {
    const index = cursor % durations.length;
    if (difference > 0 && durations[index] < 20) {
      durations[index] += 1;
      difference -= 1;
    } else if (difference < 0 && durations[index] > 2) {
      durations[index] -= 1;
      difference += 1;
    }
    cursor += 1;
  }

  return scenes.map((scene, index) => fitSceneNarration({ ...scene, durationSeconds: durations[index] }));
}
