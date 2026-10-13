/**
 * A plain question about her pills goes straight to the pill tool, not to the LLM: the tool is the only source of truth
 * about doses, and a live model probe answered "Should I take my pill now?" without calling it.
 *
 * The direct route is an optimisation for the common, unambiguous question only. Every doubt goes to the LLM, which can
 * record a dose (confirm_medication), alert Tom (report_problem) or say "Let's ask Tom". A miss costs a few seconds; a
 * wrong hit can tell Rose to take a dose she has just taken (a self-report heard as a question) or swallow a symptom.
 * So the whole utterance must be one of a few question shapes, built only from a closed list of words:
 * - the question shape names the subject ("Did I…", "Soll ich…"): a verb-first self-report without it ("Had my pills
 *   already", "Hab meine Tabletten genommen") is not a question; "Hab ich … genommen" also needs a question mark, since
 *   German drops the object in statements too ("[Die] hab ich schon genommen");
 * - one clause: no comma, no second sentence, no "and/und/aber/oder", at most nine words;
 * - her own pills only: no painkiller or sleeping pill, no symptom or feeling, nobody else's pills, no "again" or "not",
 *   no other one ("another", "noch eine", "noch 'ne"), and never "tablet": singular, it is the device ("mein Tablet").
 * Both languages are always checked.
 */

interface Shape {
  /** The words the question starts with, in order. */
  start: string[];
  /** The last word, if the shape needs one ("Soll ich … nehmen"). */
  end?: string;
  /** Only a question with its question mark ("Zeit für meine Tabletten?" could be an announcement). */
  needsQuestionMark?: boolean;
  /** At most this many words (a bare fragment like "My pills?"). */
  maxWords?: number;
}

const s = (start: string, more: Omit<Shape, "start"> = {}): Shape => ({ start: start ? start.split(" ") : [], ...more });

const SHAPES: Shape[] = [
  // English
  s("should i take"), s("shall i take"), s("can i take"),
  s("must i take"), s("do i need to take"), s("do i have to take"),
  s("did i take"), s("did i have"), s("have i taken"), s("have i had"),
  s("is it time for"), s("time for", { needsQuestionMark: true }),
  s("when is"), s("when's"), s("when are"), s("when do i take"),
  s("which"), s("what about"),
  // German
  s("soll ich", { end: "nehmen" }), s("sollte ich", { end: "nehmen" }),
  s("muss ich", { end: "nehmen" }),
  s("habe ich", { end: "genommen", needsQuestionMark: true }),
  s("hab ich", { end: "genommen", needsQuestionMark: true }),
  s("ist es zeit für"), s("zeit für", { needsQuestionMark: true }),
  s("wann kommt"), s("wann kommen"), s("wann ist"), s("wann sind"), s("wann nehme ich"),
  s("wann muss ich", { end: "nehmen" }), s("wann soll ich", { end: "nehmen" }),
  s("welche"),
  // "My pills?", "Meine Medikamente?"
  s("", { needsQuestionMark: true, maxWords: 2 }),
];

const PILL_NOUNS = new Set([
  // Not "tablet": singular it is the device, in English and in German ("Soll ich mein Tablet nehmen?"). "tablets" is pills.
  "pill", "pills", "tablets", "medication", "medications", "medicine", "medicines", "meds", "capsule", "capsules",
  "pille", "pillen", "tablette", "tabletten", "medikament", "medikamente", "medikamenten", "kapsel", "kapseln", "arznei", "medizin",
]);
/** German compounds name her own doses ("Morgentabletten", "Herzmedikament"); never "Schmerz-", "Schlaf-" or "Kaffee-". */
const OWN_COMPOUND_HEADS = ["morgen", "mittag", "abend", "nacht", "herz", "blutdruck"];
const COMPOUND_TAILS = ["tablette", "tabletten", "medikament", "medikamente", "medikamenten", "pille", "pillen", "kapsel", "kapseln"];

/** Words that may fill the rest of a pill question. Anything else (a name, a symptom, "again", "not") leaves it to the LLM. */
const FILLERS = new Set([
  "my", "the", "a", "next", "morning", "evening", "night", "bedtime", "heart", "now", "today", "yet", "already", "this", "tonight",
  "meine", "meinen", "mein", "die", "eine", "einen", "nächste", "nächsten", "jetzt", "heute", "schon", "noch", "morgens", "abends",
]);

/**
 * A second guard, in case the shapes above ever grow: a feeling, a symptom or medicine that is not her own always goes
 * to the LLM, which can alert Tom or ask him first. Broader than distress.ts, which alerts at once.
 */
const NOT_A_PLAIN_PILL_QUESTION = [
  "pain", "painkiller", "headache", "dizzy", "sick", "ill", "hurt", "feel", "sleeping", "aspirin", "ibuprofen", "paracetamol",
  "wrong", "too", "again", "another", "extra", "not", "don't", "didn't",
  "schmerz", "schmerzen", "kopfschmerz", "schwindelig", "schwindlig", "übel", "schlecht", "müde", "schlaftablette",
  "falsch", "falsche", "falschen", "zu", "viele", "nochmal", "mal", "andere", "nicht", "doch",
];
const BLOCKED_STEMS = ["schmerz", "schlaf", "kopf", "aspirin", "ibuprofen", "paracetamol"];
/** "noch" before these asks for another one ("Soll ich noch eine Tablette nehmen?"); "noch meine Tabletten" stays. */
const ANOTHER_AFTER_NOCH = ["ein", "eine", "einen", "einer", "ne", "'ne", "nen", "'nen", "mal"];

export const PILL_QUESTION_MAX_WORDS = 9;

function isPillNoun(w: string): boolean {
  if (PILL_NOUNS.has(w)) return true;
  return OWN_COMPOUND_HEADS.some((h) => COMPOUND_TAILS.some((t) => w === h + t));
}

export function detectPillQuestion(text: string): boolean {
  let t = text.toLowerCase().replace(/[‘’`]/g, "'").replace(/-/g, "").trim();
  const questionMark = /\?[?!.\s]*$/.test(t);
  t = t.replace(/[?!.\s]+$/, "");
  // Anything left that is not a word, an apostrophe or a space is a second clause or sentence: "…, I feel dizzy".
  if (!t || /[^\p{L}\p{N}' ]/u.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > PILL_QUESTION_MAX_WORDS) return false;
  if (words.some((w) => BLOCKED_STEMS.some((b) => w.includes(b)))) return false;
  if (words.some((w) => NOT_A_PLAIN_PILL_QUESTION.includes(w))) return false;
  if (words.some((w, i) => w === "noch" && ANOTHER_AFTER_NOCH.includes(words[i + 1] ?? ""))) return false;
  return SHAPES.some((shape) => matches(shape, words, questionMark));
}

function matches(shape: Shape, words: string[], questionMark: boolean): boolean {
  if (shape.needsQuestionMark && !questionMark) return false;
  if (shape.maxWords !== undefined && words.length > shape.maxWords) return false;
  if (!shape.start.every((w, i) => words[i] === w)) return false;
  let rest = words.slice(shape.start.length);
  if (shape.end !== undefined) {
    if (rest.at(-1) !== shape.end) return false;
    rest = rest.slice(0, -1);
  }
  if (!rest.some(isPillNoun)) return false;
  return rest.every((w) => isPillNoun(w) || FILLERS.has(w));
}
