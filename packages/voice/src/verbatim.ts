import { splitSentences, type Locale } from "@mia/shared";

export const MAX_LEAD_IN_WORDS = 5;

/** Words that make a lead-in state a fact (yes/no, done/not done); only the tools' templates may say these. */
export const FACT_WORDS: Record<"en" | "de", string[]> = {
  en: ["yes", "no", "not", "yet", "did", "didn't", "took", "taken", "already", "never", "done"],
  de: ["ja", "nein", "nicht", "noch", "schon", "genommen", "hast", "hattest", "keine", "erledigt"],
};

function statesFact(s: string, locale: Locale): boolean {
  if (/\d/.test(s)) return true;
  const list = new Set(FACT_WORDS[locale === "de-DE" ? "de" : "en"]);
  return s.toLowerCase().split(/\s+/).some((w) => list.has(w.replace(/^[^\p{L}']+|[^\p{L}']+$/gu, "")));
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Spec §8 rule 6: critical sentences come from the tools' templates, word for word.
 * The LLM may add one warm lead-in of at most five words; anything else it wrote is dropped.
 */
export function enforceVerbatim(llmText: string, says: string[], locale: Locale): string[] {
  const llmSentences = splitSentences(llmText, locale);
  if (!says.length) return llmSentences;
  const templateSentences = says.flatMap((s) => splitSentences(s, locale));
  const first = llmSentences[0];
  const isTemplate = (s: string) => templateSentences.some((t) => norm(t) === norm(s));
  const words = first ? first.split(/\s+/).filter(Boolean).length : 0;
  const leadIn = first && !isTemplate(first) && words <= MAX_LEAD_IN_WORDS && !first.endsWith("?") && !statesFact(first, locale) ? [first] : [];
  return [...leadIn, ...templateSentences];
}
