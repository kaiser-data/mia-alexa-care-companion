/**
 * Keyword half of the distress double check (spec §9.7): either this or the LLM triggers report_problem.
 * Both languages are always checked — she may switch language when frightened.
 * A false alarm costs a message to the carer; a missed fall costs far more, so the lists lean towards alarm.
 */
const ALWAYS = [
  "i fell", "fell down", "fallen down", "i've fallen", "i have fallen", "can't get up", "cannot get up", "can not get up",
  "can't stand up", "cannot stand up", "can't breathe", "cannot breathe", "chest pain", "i slipped", "i tripped",
  "i'm stuck", "i am stuck", "somebody help", "someone help",
  "hurt", "hurts", "in pain", "ambulance", "emergency", "bleeding", "call for help",
  "gestürzt", "hingefallen", "umgefallen", "bin gefallen", "ausgerutscht", "komme nicht hoch", "komme nicht mehr hoch",
  "kann nicht aufstehen", "kann nicht mehr aufstehen", "keine luft", "weh", "schmerzen",
  "notarzt", "krankenwagen", "notfall", "blute", "blutet", "hilfe holen",
  // Too many or the wrong pills is a possible emergency, never a question for the pill tool.
  "too many pills", "too many tablets", "took too many", "double dose", "overdose", "wrong pills",
  "pills twice", "tablets twice", "took them twice", "took it twice",
  "tablet twice", "medication twice", "medicine twice", "taken them twice", "taken it twice", "pills two times", "tablets two times",
  "zu viele tabletten", "zu viel genommen", "doppelt genommen", "zweimal genommen", "zweimal eingenommen", "doppelt eingenommen", "tablette zweimal", "falsche tabletten", "überdosis",
  "doppelte dosis", "doppelten dosis",
];

/**
 * Pills taken a second time ("Ich habe heute zweimal meine Tabletten genommen", "I took my pills again"): inside one clause,
 * a past "taken" verb, a repeat word and a pill word in the order each language uses.
 * - German puts the participle last: the repeat word and the pill word come before "genommen"/"eingenommen"/"geschluckt"
 *   ("… sie noch mal genommen": a repeat word right before the participle is enough).
 * - English puts the verb first: "took/taken/had/swallowed", then the pill word and the repeat word after it.
 * Clauses end at sentence marks, at and/und/but/aber/then/dann/so/also and where a new "I/ich" clause starts, so
 * "Ich habe Tabletten genommen und dann nochmal Tom angerufen" or "I took my pills, I'll check again later" stay quiet.
 * A plan question has no past verb ("Should I take them again?"); a missed dose has no "taken" ("I forgot my pills again")
 * or a negation just before it ("I haven't taken …", "nicht noch mal genommen").
 *
 * Policy (controller decision, accepted false positive): English "again" after a taken-verb about pills always alarms,
 * even "I took my pills again today" said as the daily report — a possible emergency always alerts, a false alarm costs
 * one mail to the carer. German bare "wieder" stays quiet ("Ich habe heute wieder meine Tabletten genommen" is the daily
 * report); "schon wieder" (yet again) counts as a repeat word.
 */
const PILL_WORDS = new Set(["pill", "pills", "tablet", "tablets", "medicine", "medicines", "medication", "medications", "meds", "dose", "doses",
  "tablette", "tabletten", "pille", "pillen", "medikament", "medikamente", "medizin", "dosis", "arznei"]);
const TAKEN_WORDS = new Set(["took", "taken", "swallowed", "had", "genommen", "eingenommen", "geschluckt"]);
const EN_PRONOUNS = new Set(["them", "it", "those", "these"]);
const GERMAN_TAKEN = new Set(["genommen", "eingenommen", "geschluckt"]);
const REPEAT = "zweimal";
const REPEAT_WORDS = new Set([REPEAT, "twice", "again"]);
const REPEAT_PHRASES = /\b(?:a second time|second time|one more time|two times|noch mal|noch einmal|nochmal|nochmals|zum zweiten mal|ein zweites mal|zwei mal)\b/g;
const CLAUSE_BREAKS = new Set(["and", "und", "but", "aber", "then", "dann", "so", "also", "i", "i'll", "i'm", "i've", "i'd", "ich"]);
const isNegation = (w: string | undefined) => w !== undefined && (["not", "never", "nicht", "nie", "kein", "keine"].includes(w) || w.endsWith("n't"));
/** German: the repeat and pill words are at most this many words before the participle. */
const DE_SPAN = 5;
/** English: the pill word and the repeat word are at most this many words after the verb. */
const EN_PILL_SPAN = 4;
const EN_REPEAT_SPAN = 6;

function clauses(n: string): string[][] {
  const out: string[][] = [[]];
  for (const w of n.replace(REPEAT_PHRASES, REPEAT).split(" ")) {
    if (CLAUSE_BREAKS.has(w)) out.push([]);
    else out[out.length - 1]!.push(w);
  }
  return out;
}

function takenAgainInClause(words: string[]): boolean {
  const at = (set: Set<string>) => words.flatMap((w, i) => (set.has(w) ? [i] : []));
  const taken = at(TAKEN_WORDS).filter((i) => !isNegation(words[i - 1]) && !isNegation(words[i - 2]));
  const repeats = at(REPEAT_WORDS);
  const pills = at(PILL_WORDS);
  return taken.some((t) => {
    if (GERMAN_TAKEN.has(words[t]!)) {
      if (words[t - 1] === REPEAT) return true;
      return repeats.some((r) => r < t && t - r <= DE_SPAN) && pills.some((p) => p < t && t - p <= DE_SPAN);
    }
    // "I took them again" after the pill talk: the pronoun stands for the pills when the repeat word follows at once.
    if (EN_PRONOUNS.has(words[t + 1]!) && words[t + 2] !== undefined && REPEAT_WORDS.has(words[t + 2]!)) return true;
    return pills.some((p) => p > t && p - t <= EN_PILL_SPAN) && repeats.some((r) => r > t && r - t <= EN_REPEAT_SPAN);
  });
}

function takenAgain(text: string): boolean {
  return text.split(/[.!?;:]+/).some((sentence) => clauses(normalise(sentence)).some(takenAgainInClause));
}
/** Only alarming on their own: "help" in a long sentence is usually an ordinary request. */
const SHORT_ONLY = ["help", "help me", "please help", "help please", "hilfe", "hilf mir", "bitte hilfe", "hilfe bitte"];
/** An utterance that starts with this word is a call for help ("Hilfe, ich bin im Bad"), unless it is "help me …" (a request). */
const OPENING_CRY = ["help", "hilfe"];
export const SHORT_UTTERANCE_WORDS = 4;

function normalise(text: string): string {
  return text
    .toLowerCase()
    // Speech recognition often writes typographic apostrophes (U+2018/U+2019) or backticks.
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\b(fell|fallen) (asleep|in love)\b/g, " ")
    .replace(/\b(?:(?:twice|two times|zweimal) (?:a|am|die|pro) (?:day|week|tag|woche)|(?:twice|two times) daily|zweimal täglich)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectDistress(text: string): boolean {
  const n = normalise(text);
  if (!n) return false;
  const padded = ` ${n} `;
  const has = (phrase: string) => padded.includes(` ${phrase} `);
  if (ALWAYS.some(has) || takenAgain(text)) return true;
  const words = n.split(" ");
  if (OPENING_CRY.includes(words[0]!) && words[1] !== "me") return true;
  return words.length <= SHORT_UTTERANCE_WORDS && SHORT_ONLY.some(has);
}
