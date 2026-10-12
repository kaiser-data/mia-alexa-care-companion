/**
 * A question about her pills goes straight to the pill tool, not to the LLM: the tool is the only source of truth
 * about doses, and a live model probe answered "Should I take my pill now?" without calling it.
 * Only questions: a self-report ("I took my pill", "Ich habe meine Tablette genommen") stays with the LLM,
 * which records it with confirm_medication. Both languages are always checked.
 * The utterance must be the question itself: it starts with a question word or verb ("Did I…", "Soll ich…"), or it is a
 * short fragment with a question mark ("My pills?"). Anything said before the question ("I feel dizzy, did I…?")
 * leaves the turn to the LLM, which can also alert Tom.
 */
const PILL_WORDS = [
  "pill", "pills", "tablet", "tablets", "medication", "medications", "medicine", "medicines", "meds", "capsule", "capsules",
  "pille", "pillen", "tablette", "tabletten", "medikament", "medikamente", "medikamenten", "kapsel", "kapseln", "arznei",
];
/** German compounds name pills too: "Morgentabletten", "Herzmedikament". Not "Kaffeekapseln": a capsule only on its own. */
const PILL_ENDINGS = ["tablette", "tabletten", "medikament", "medikamente", "medikamenten"];
/** A question starts with a question word or a verb; speech recognition often leaves out the question mark. */
const QUESTION_START = [
  "should", "shall", "did", "do", "does", "have", "has", "had", "is", "are", "am", "was", "when", "what", "which", "where",
  "how", "can", "may", "must", "need", "time",
  "soll", "sollte", "habe", "hab", "hatte", "muss", "darf", "kann", "ist", "sind", "wann", "was", "welche", "welcher",
  "welches", "wo", "wie", "brauche", "nehme", "zeit",
];

/** "My pills?", "Meine Medikamente?": a question by its question mark alone only when this short. */
const SHORT_FRAGMENT_WORDS = 4;

export function detectPillQuestion(text: string): boolean {
  const words = text
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .split(/[^\p{L}\p{N}']+/u)
    .filter(Boolean);
  if (!words.length) return false;
  const aboutPills = words.some((w) => PILL_WORDS.includes(w) || PILL_ENDINGS.some((e) => w.endsWith(e)));
  return aboutPills && (QUESTION_START.includes(words[0]!) || (text.includes("?") && words.length <= SHORT_FRAGMENT_WORDS));
}
