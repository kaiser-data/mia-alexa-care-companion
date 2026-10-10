import { splitSentences, type Locale } from "@mia/shared";

export const MAX_LEAD_IN_WORDS = 5;
/** Spec §8: at most four short sentences per answer. */
export const MAX_SENTENCES = 4;

/** The only openers a lead-in may use: warm, and free of any fact. */
export const LEAD_INS: Record<"en" | "de", string[]> = {
  en: ["of course", "sure", "alright", "all right", "okay", "let me see", "let me check", "gladly", "good"],
  de: ["natürlich", "gern", "gerne", "klar", "einen moment", "lass mich schauen", "gut"],
};
/** Forms of address that may follow the opener, besides her preferred name. */
const ADDRESS: Record<"en" | "de", string[]> = { en: ["dear", "love"], de: ["meine Liebe"] };

const lang = (locale: Locale) => (locale === "de-DE" ? "de" : "en");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function isLeadIn(s: string, locale: Locale, preferredName?: string): boolean {
  const l = lang(locale);
  const address = [...ADDRESS[l], ...(preferredName ? [preferredName] : [])].map(escape).join("|");
  const re = new RegExp(`^(?:${LEAD_INS[l].map(escape).join("|")})(?:,\\s*(?:${address}))?[.!]$`, "iu");
  return s.trim().split(/\s+/).length <= MAX_LEAD_IN_WORDS && re.test(s.trim());
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Spec §8 rule 6: critical sentences come from the tools' templates, word for word.
 * The LLM may add one allow-listed warm lead-in; anything else it wrote is dropped.
 * Never more than four sentences: the lead-in is dropped first.
 */
export function enforceVerbatim(llmText: string, says: string[], locale: Locale, preferredName?: string): string[] {
  const llmSentences = splitSentences(llmText, locale);
  if (!says.length) return llmSentences.slice(0, MAX_SENTENCES);
  const templateSentences = says.flatMap((s) => splitSentences(s, locale));
  const first = llmSentences[0];
  const isTemplate = (s: string) => templateSentences.some((t) => norm(t) === norm(s));
  const leadIn = first && !isTemplate(first) && isLeadIn(first, locale, preferredName) ? [first] : [];
  const all = [...leadIn, ...templateSentences];
  return (all.length > MAX_SENTENCES ? templateSentences : all).slice(0, MAX_SENTENCES);
}

/** Words that make an LLM sentence about her medication (both languages: she may switch). */
export const MED_WORDS = [
  "pill", "pills", "tablet", "tablets", "medicine", "medication", "medications", "dose",
  "tablette", "tabletten", "pille", "pillen", "medikament", "medikamente",
];
/** Weekdays, months and clock words: an LLM sentence with these (or a digit) states a date or time. */
export const DATE_WORDS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "april", "june", "july", "august", "september", "october", "november", "december",
  "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonnabend", "sonntag",
  "januar", "februar", "märz", "mai", "juni", "juli", "oktober", "dezember",
  "o'clock", "uhr",
];

const words = (s: string) => s.toLowerCase().replace(/[‘’`]/g, "'").split(/[^\p{L}\p{N}']+/u).filter(Boolean);

/**
 * Owner policy: Mia never states a fact she did not get from a tool.
 * For an LLM answer that used no verbatim tool, names the tool whose answer must be spoken instead, or null.
 * Questions ("Do you mean your pills?") are allowed. A statement answering her question about pills counts as a
 * medication fact even without a pill word ("Yes, you took them."). ("May" and "March" are left out of the
 * date words: they are ordinary English words.)
 */
export function factGuard(sentences: string[], userText = ""): "get_medication_status" | "get_today" | null {
  const statements = sentences.filter((s) => !s.trim().endsWith("?"));
  const aboutMeds = (s: string) => words(s).some((w) => MED_WORDS.includes(w));
  if (statements.some(aboutMeds) || (statements.length > 0 && aboutMeds(userText))) return "get_medication_status";
  if (statements.some((s) => /\d/.test(s) || words(s).some((w) => DATE_WORDS.includes(w)))) return "get_today";
  return null;
}
