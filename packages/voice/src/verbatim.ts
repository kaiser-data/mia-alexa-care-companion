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

/** Verbs of taking a medicine: "take it now" is a medication fact even without a pill word. */
export const TAKE_VERBS = [
  "take", "takes", "took", "taken", "had",
  "nehmen", "nimm", "nimmst", "genommen", "eingenommen", "hattest",
];
/** Spelled-out numbers: "at nine" states a time as much as "at 9". */
export const NUMBER_WORDS = [
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "half", "quarter",
  "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf", "halb", "viertel",
];
/** Words that place something on a day: "tomorrow" is a date she must get from a tool. */
export const RELATIVE_DAY_WORDS = [
  "today", "tomorrow", "yesterday", "tonight", "morning", "afternoon", "evening", "night",
  "heute", "morgen", "gestern", "abend", "früh", "nachmittag", "vormittag", "nacht",
];
/** Greetings are not times of day: "Good morning" and "Guten Morgen" are removed before the check. */
const GREETINGS = [
  "good morning", "good afternoon", "good evening", "good night", "guten morgen", "guten tag", "guten abend", "gute nacht",
];

const words = (s: string) => s.toLowerCase().replace(/[‘’`]/g, "'").split(/[^\p{L}\p{N}']+/u).filter(Boolean);
const GREETING_RE = new RegExp(`(?<=^| )(?:${GREETINGS.join("|")})(?= |$)`, "gu");
/** The words of a sentence, without greetings. */
const factWords = (s: string) => words(s).join(" ").replace(GREETING_RE, " ").split(" ").filter(Boolean);

const isQuestion = (s: string) => s.trim().endsWith("?");
const hasAny = (list: string[]) => (s: string) => factWords(s).some((w) => list.includes(w));
const hasMed = hasAny(MED_WORDS);
const hasTake = hasAny(TAKE_VERBS);
const hasDateWord = hasAny([...DATE_WORDS, ...NUMBER_WORDS, ...RELATIVE_DAY_WORDS]);
const hasDigit = (s: string) => /\d/.test(s);

/** A sentence with no fact marker at all (no medicine, taking, number, date or day word, no digit). */
export function isFactFree(s: string): boolean {
  return !hasMed(s) && !hasTake(s) && !hasDateWord(s) && !hasDigit(s);
}

export interface FactGuardOptions {
  /** A non-verbatim tool (such as chat_about_life) ran this turn: its facts may be retold, so dates are allowed. */
  chatTool: boolean;
  /** The previous turn was about her pills (get_medication_status or confirm_medication). */
  lastWasMedication: boolean;
}

/**
 * Owner policy: Mia never states a fact she did not get from a tool.
 * For an LLM answer that used no verbatim tool, names the tool whose answer must be spoken instead, or null.
 * Medication: any statement with a pill word; any sentence, question or not, with a taking verb in a pill context
 * ("Yes, take it now.", "You took them at 8, didn't you?"); any statement answering her question about pills.
 * A checking question whose only marker is a pill word ("Do you mean your pills?") is allowed.
 * Date and time: statements with a digit, date, number or day word, and questions with a digit; skipped after a chat
 * tool. ("May" and "March" are left out of the date words: they are ordinary English words.)
 */
export function factGuard(sentences: string[], userText: string, opts: FactGuardOptions): "get_medication_status" | "get_today" | null {
  const statements = sentences.filter((s) => !isQuestion(s));
  const pillContext = hasMed(userText) || hasTake(userText) || opts.lastWasMedication;
  if (
    statements.some(hasMed)
    || sentences.some((s) => hasTake(s) && (pillContext || hasMed(s)))
    || (statements.length > 0 && hasMed(userText))
  ) return "get_medication_status";
  if (opts.chatTool) return null;
  if (statements.some((s) => hasDigit(s) || hasDateWord(s)) || sentences.some((s) => isQuestion(s) && hasDigit(s))) return "get_today";
  return null;
}
