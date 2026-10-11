import type { Locale } from "../domain/types";

/**
 * The voice router's phrase catalogue: the LLM picks ids, it never writes sentences.
 * Fact-free only: no times, dates, numbers, pills or facts about people.
 * `{name}` is her preferred name, `{carer}` the carer's name.
 */
export type PhraseKind = "opener" | "feeling" | "question" | "closing";
export interface Phrase { id: string; kind: PhraseKind; en: string; de: string }

export const PHRASES: Phrase[] = [
  // openers — at most one, before the tool sentences
  { id: "of_course", kind: "opener", en: "Of course, {name}.", de: "Natürlich, {name}." },
  { id: "let_me_see", kind: "opener", en: "Let me see.", de: "Lass mich schauen." },
  { id: "hello", kind: "opener", en: "Hello, {name}.", de: "Hallo, {name}." },
  { id: "good_morning", kind: "opener", en: "Good morning, {name}.", de: "Guten Morgen, {name}." },
  { id: "good_evening", kind: "opener", en: "Good evening, {name}.", de: "Guten Abend, {name}." },
  // feelings — at most one
  { id: "oh_dear", kind: "feeling", en: "Oh dear.", de: "Oh je." },
  { id: "im_sorry", kind: "feeling", en: "I'm sorry to hear that.", de: "Das tut mir leid." },
  { id: "sounds_lovely", kind: "feeling", en: "That sounds lovely.", de: "Das klingt schön." },
  { id: "im_glad", kind: "feeling", en: "I'm glad.", de: "Das freut mich." },
  { id: "youre_welcome", kind: "feeling", en: "You're welcome.", de: "Gern geschehen." },
  { id: "thank_you", kind: "feeling", en: "Thank you.", de: "Danke." },
  { id: "im_here", kind: "feeling", en: "I'm here with you.", de: "Ich bin bei dir." },
  // questions — at most one, always last, always yes/no
  { id: "offer_call", kind: "question", en: "Shall I ask {carer} to call you?", de: "Soll ich {carer} um einen Anruf bitten?" },
  { id: "anything_else", kind: "question", en: "Can I help with anything else?", de: "Kann ich sonst noch helfen?" },
  { id: "check_pills", kind: "question", en: "Do you mean your pills?", de: "Meinst du deine Tabletten?" },
  { id: "check_day", kind: "question", en: "Do you want to know what day it is?", de: "Möchtest du wissen, welcher Tag heute ist?" },
  { id: "check_group", kind: "question", en: "Do you mean your group?", de: "Meinst du deine Gruppe?" },
  { id: "check_music", kind: "question", en: "Would you like some music?", de: "Möchtest du etwas Musik hören?" },
  { id: "check_chat", kind: "question", en: "Shall we have a little chat?", de: "Wollen wir ein bisschen plaudern?" },
  // closings — at most one, replaces the question
  { id: "sleep_well", kind: "closing", en: "Sleep well, {name}.", de: "Schlaf gut, {name}." },
  { id: "lovely_day", kind: "closing", en: "Have a lovely day, {name}.", de: "Hab einen schönen Tag, {name}." },
  { id: "lovely_evening", kind: "closing", en: "Have a lovely evening, {name}.", de: "Hab einen schönen Abend, {name}." },
];

const BY_ID = new Map(PHRASES.map((p) => [p.id, p]));

/** The phrase in her language with name and carer filled in, or null for an unknown id. */
export function phraseText(id: string, locale: Locale, vars: { name: string; carer: string }): string | null {
  const p = BY_ID.get(id);
  if (!p) return null;
  return (locale === "de-DE" ? p.de : p.en).replaceAll("{name}", vars.name).replaceAll("{carer}", vars.carer);
}

/** The ids of one kind, in catalogue order. */
export function phraseIds(kind: PhraseKind): string[] {
  return PHRASES.filter((p) => p.kind === kind).map((p) => p.id);
}
