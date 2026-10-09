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
];
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
    .replace(/\s+/g, " ")
    .trim();
}

export function detectDistress(text: string): boolean {
  const n = normalise(text);
  if (!n) return false;
  const padded = ` ${n} `;
  const has = (phrase: string) => padded.includes(` ${phrase} `);
  if (ALWAYS.some(has)) return true;
  const words = n.split(" ");
  if (OPENING_CRY.includes(words[0]!) && words[1] !== "me") return true;
  return words.length <= SHORT_UTTERANCE_WORDS && SHORT_ONLY.some(has);
}
