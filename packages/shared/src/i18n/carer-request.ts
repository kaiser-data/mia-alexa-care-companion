import { HEALTH_STEMS, HEALTH_WORDS, isPillNoun } from "./pill-question";

/**
 * At night, a request for the carer or a health or medicine question skips night reassurance, even as the first thing
 * she says (owner decision 2026-10-13): "Can Tom call me?" answered with "You can go back to sleep" ignores the one thing
 * she asked for, and a dizzy spell from her pills must reach the LLM, which can ask Tom or alert him.
 *
 * A false positive only costs a skipped reassurance (the LLM still answers calmly), so the lists lean inclusive; but a
 * plain "I can't sleep" / "Ich kann nicht schlafen" stays false: that is what night reassurance is for.
 * Distress (distress.ts) and the pill route (pill-question.ts) are checked before this and keep their priority.
 * Both languages are always checked.
 */

/** Words that, beside the carer's name, ask for him: "Call Tom", "Where is Tom?", "Ich will Tom sprechen". */
const ASK_FOR = new Set([
  "call", "calls", "calling", "ring", "phone", "want", "need", "where", "where's", "talk", "speak", "see", "get", "fetch",
  "come", "coming", "here", "miss",
  "ruf", "rufe", "rufen", "anrufen", "anruft", "anrufe", "telefonieren", "will", "möchte", "möchten", "brauche", "wo",
  "sprechen", "reden", "sehen", "hol", "hole", "holen", "komm", "kommen", "kommt", "vermisse",
]);
/** "Tom?", "Tom, bitte": the name on its own, in at most this many words. */
const NAME_ONLY_WORDS = 2;

/** Symptoms and health words beyond the pill-question lists (whole words). */
const MORE_HEALTH_WORDS = [
  "unwell", "nauseous", "nausea", "fever", "temperature", "vomit", "vomiting", "doctor", "medical",
  "ache", "aches", "aching", "stomachache", "backache", "toothache", "earache",
  "krank", "unwohl", "fieber", "übelkeit", "arzt", "ärztin", "doktor",
];
/** Word parts: "dizziness", "Schwindelgefühl". Not "ache" or "schwind": "machen", "Sache", "verschwinden". */
const MORE_HEALTH_STEMS = ["dizz", "schwindel"];
/** Word endings: "Kopfweh", "Bauchweh". */
const HEALTH_ENDINGS = ["weh"];

function words(text: string): string[] {
  return text
    .toLowerCase()
    // Speech recognition often writes typographic apostrophes (U+2018/U+2019) or backticks.
    .replace(/[‘’`]/g, "'")
    .replace(/-/g, "")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function asksForCarer(ws: string[], carerName: string): boolean {
  const name = carerName.trim().toLowerCase();
  if (!name || /\s/.test(name)) return false;
  // "Tom", "Tom's", German genitive "Toms"; never "Tomorrow".
  const isName = (w: string) => w === name || w === `${name}'s` || w === `${name}s`;
  if (!ws.some(isName)) return false;
  if (ws.length <= NAME_ONLY_WORDS) return true;
  return ws.some((w) => ASK_FOR.has(w));
}

function isHealthQuestion(ws: string[]): boolean {
  return ws.some((w) =>
    HEALTH_WORDS.includes(w) || MORE_HEALTH_WORDS.includes(w) || isPillNoun(w)
    || HEALTH_STEMS.some((st) => w.includes(st)) || MORE_HEALTH_STEMS.some((st) => w.includes(st))
    || HEALTH_ENDINGS.some((e) => w.endsWith(e)));
}

/** True when she asks for the carer (by the name in her profile) or asks a health or medicine question. */
export function detectCarerOrHealthRequest(text: string, carerName: string): boolean {
  const ws = words(text);
  if (!ws.length) return false;
  return asksForCarer(ws, carerName) || isHealthQuestion(ws);
}
