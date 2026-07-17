const allowedLatinTerms = [
  /\bknow\s+video\b/giu,
  /\bAI\b/gu,
  /\bAPI\b/gu,
  /\bUI\b/gu,
  /\bUX\b/gu,
  /\bSaaS\b/gu,
  /\bMP4\b/gu,
  /\bWebM\b/gu,
  /\blogo\b/giu
];

export function looksSimplifiedChineseLocalized(value?: string) {
  if (!value || !/\p{Script=Han}/u.test(value)) return false;
  const withoutAllowedTerms = allowedLatinTerms.reduce(
    (text, pattern) => text.replace(pattern, ""),
    value
  );
  const hanCount = (withoutAllowedTerms.match(/\p{Script=Han}/gu) ?? []).length;
  const latinLetters = (withoutAllowedTerms.match(/[A-Za-z]/g) ?? []).length;
  const longLatinPhrases = withoutAllowedTerms.match(/[A-Za-z]{3,}(?:[\s-]+[A-Za-z]{3,})+/gu) ?? [];
  return longLatinPhrases.length === 0 && latinLetters <= Math.max(8, hanCount * 1.5);
}
