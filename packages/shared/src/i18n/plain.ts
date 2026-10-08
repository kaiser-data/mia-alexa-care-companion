import type { Locale } from "../domain/types";

export const PLAIN_LIMITS = {
  simple: { maxWords: 12, maxSentences: 4 },
  very_simple: { maxWords: 8, maxSentences: 3 },
} as const;

const FORBIDDEN: Record<Locale, string[]> = {
  "en-US": ["already asked", "as i said", "i told you", "you asked that"],
  "de-DE": ["schon gefragt", "wie gesagt", "hab ich doch", "habe ich dir doch"],
};

export function splitSentences(text: string, locale: Locale = "en-US"): string[] {
  // In German a dot after a number is an ordinal ("12. Oktober"), not a sentence end.
  const end = locale === "de-DE" ? /(?<=[^\d\s][.!?]|\d[!?])\s+/ : /(?<=[.!?])\s+/;
  return text.split(end).map((s) => s.trim()).filter(Boolean);
}

const countWords = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

export function checkPlain(text: string, locale: Locale, level: keyof typeof PLAIN_LIMITS = "simple"): { ok: boolean; problems: string[] } {
  const limits = PLAIN_LIMITS[level];
  const problems: string[] = [];
  const sentences = splitSentences(text, locale);
  if (sentences.length > limits.maxSentences) problems.push(`${sentences.length} sentences (max ${limits.maxSentences})`);
  for (const s of sentences) {
    const n = countWords(s);
    if (n > limits.maxWords) problems.push(`${n} words (max ${limits.maxWords}): "${s}"`);
  }
  const lower = text.toLowerCase();
  for (const f of FORBIDDEN[locale]) if (lower.includes(f)) problems.push(`forbidden phrase "${f}"`);
  return { ok: problems.length === 0, problems };
}
