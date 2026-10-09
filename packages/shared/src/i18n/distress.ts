/**
 * Keyword half of the distress double check (spec §9.7): either this or the LLM triggers report_problem.
 * Both languages are always checked — she may switch language when frightened.
 * A false alarm costs a message to the carer; a missed fall costs far more, so the lists lean towards alarm.
 */
const ALWAYS = [
  "i fell", "fell down", "fallen down", "i've fallen", "i have fallen", "can't get up", "cannot get up", "can not get up",
  "hurt", "hurts", "in pain", "ambulance", "emergency", "bleeding", "call for help",
  "gestürzt", "hingefallen", "umgefallen", "komme nicht hoch", "kann nicht aufstehen", "weh", "schmerzen",
  "notarzt", "krankenwagen", "notfall", "blute", "hilfe holen",
];
/** Only alarming on their own: "help" in a long sentence is usually an ordinary request. */
const SHORT_ONLY = ["help", "help me", "please help", "help please", "hilfe", "hilf mir", "bitte hilfe", "hilfe bitte"];
export const SHORT_UTTERANCE_WORDS = 4;

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/['`]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\b(fell|fallen) asleep\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectDistress(text: string): boolean {
  const n = normalise(text);
  if (!n) return false;
  const padded = ` ${n} `;
  const has = (phrase: string) => padded.includes(` ${phrase} `);
  if (ALWAYS.some(has)) return true;
  return n.split(" ").length <= SHORT_UTTERANCE_WORDS && SHORT_ONLY.some(has);
}
