import { phraseIds, phraseText, splitSentences, type Locale, type PhraseKind } from "@mia/shared";
import type { ToolInfo } from "./mcp";

/** Spec §8: at most four short sentences per answer (tool sentences are never cut). */
export const MAX_SENTENCES = 4;
export const MAX_CHAT_SENTENCES = 2;
export const MAX_CHAT_CHARS = 200;
export const MAX_CHAT_WORDS = 12;

const slot = (kind: PhraseKind) => ({ type: "string", enum: ["none", ...phraseIds(kind)] });

/**
 * "Claude picks, doesn't write": the LLM ends every turn by choosing phrase ids here.
 * Defined by the voice gateway, not by the Mia MCP server; always sent last.
 */
export const RESPOND_TOOL: ToolInfo = {
  name: "respond",
  description: "Always finish your turn by calling this. Mia speaks the tool sentences you collected, wrapped in these phrases. You cannot write your own sentences; use \"none\" where nothing fits.",
  strict: true,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["opener", "feeling", "question", "closing", "chat"],
    properties: {
      opener: slot("opener"),
      feeling: slot("feeling"),
      question: slot("question"),
      closing: slot("closing"),
      chat: {
        type: "string",
        description: "Empty string, except right after chat_about_life: one or two short warm sentences (max 200 characters) about the suggested topic.",
      },
    },
  },
};

export interface RespondInput { opener?: string; feeling?: string; question?: string; closing?: string; chat?: string }

/** What chat_about_life returned: the only source the chat text may draw names and numbers from. */
export interface ChatFacts { topics: string[]; suggestedTopic: string; carerName?: string }

export interface ComposeContext {
  locale: Locale;
  name: string;
  carer: string;
  /** Set only when chat_about_life ran in this turn or the previous one; otherwise the chat text is ignored. */
  chatFacts?: ChatFacts;
}

/** Reads the respond input defensively: anything that is not a string counts as "none". */
export function readRespond(input: Record<string, unknown>): RespondInput {
  const out: RespondInput = {};
  for (const k of ["opener", "feeling", "question", "closing", "chat"] as const) {
    const v = input[k];
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** The phrase for a slot, only if the id exists and is of that slot's kind. */
function pick(id: string | undefined, kind: PhraseKind, ctx: ComposeContext): string | null {
  if (!id || id === "none" || !phraseIds(kind).includes(id)) return null;
  return phraseText(id, ctx.locale, { name: ctx.name, carer: ctx.carer });
}

/**
 * Builds what Mia says: lead (feeling wins over opener), tool sentences verbatim, checked chat,
 * then a question (or a closing if there is no question). Cap of four: the lead goes first,
 * then chat sentences, then the question/closing; tool sentences are never cut.
 * Nothing to say → the call offer.
 */
export function compose(toolSays: string[], choice: RespondInput | null, ctx: ComposeContext): string[] {
  const c = choice ?? {};
  const tools = toolSays.flatMap((s) => splitSentences(s, ctx.locale));
  const lead = pick(c.feeling, "feeling", ctx) ?? pick(c.opener, "opener", ctx);
  const end = pick(c.question, "question", ctx) ?? pick(c.closing, "closing", ctx);
  let chat = ctx.chatFacts && c.chat ? checkChat(c.chat, ctx.chatFacts, ctx) : [];

  let leads = lead ? [lead] : [];
  let ends = end ? [end] : [];
  const total = () => leads.length + tools.length + chat.length + ends.length;
  if (total() > MAX_SENTENCES) leads = [];
  while (total() > MAX_SENTENCES && chat.length) chat = chat.slice(0, -1);
  if (total() > MAX_SENTENCES) ends = [];

  const out = [...leads, ...tools, ...chat, ...ends];
  if (out.length) return out;
  return [phraseText("offer_call", ctx.locale, { name: ctx.name, carer: ctx.carer })!];
}

const MED_WORDS = [
  "pill", "pills", "tablet", "tablets", "medicine", "medication", "medications", "dose",
  "tablette", "tabletten", "pille", "pillen", "medikament", "medikamente",
];
/** Open questions she may find hard to answer; per language, since German "Was …?" is "what" but English "Was …?" is yes/no. */
const WH_WORDS: Record<Locale, string[]> = {
  "en-US": ["what", "where", "when", "who", "why", "how"],
  "de-DE": ["wie", "was", "wo", "wann", "wer", "warum"],
};
/** Spelled-out numbers: "forty years" states a number as much as "40 years". */
const NUMBER_WORDS = [
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand",
  "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf",
  "zwanzig", "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig", "neunzig", "hundert", "tausend",
];
/** Ordinary first words of a chat sentence; any other capitalised word must come from the tool's facts. */
const STARTERS = [
  "you", "your", "i", "it", "that", "this", "there", "what", "was", "were", "did", "do", "does", "is", "are",
  "shall", "would", "could", "can", "and", "oh", "we", "she", "he", "they",
  "du", "dein", "deine", "deinen", "deinem", "deiner", "ich", "es", "das", "war", "warst", "hast", "bist", "ist",
  "magst", "mochtest", "erinnerst", "weißt", "wollen", "sollen", "soll", "wir", "und", "da",
];

const tokens = (s: string) => s.replace(/[‘’`]/g, "'").split(/[^\p{L}\p{N}']+/u).filter(Boolean);
const countWords = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/**
 * Owner policy: Mia states no fact she did not get from a tool. A chat sentence is dropped when it
 * is longer than twelve words; names a person, place or number (capitalised word, digit or number word)
 * that is not in the facts chat_about_life returned; mentions medication; or asks an open (wh-) question.
 * At most two sentences and 200 characters.
 */
export function checkChat(text: string, facts: ChatFacts, ctx: Pick<ComposeContext, "locale" | "name" | "carer">): string[] {
  const source = [...facts.topics, facts.suggestedTopic, facts.carerName ?? "", ctx.name, ctx.carer].join(" ");
  const known = new Set(tokens(source).map((w) => w.toLowerCase()));
  const kept: string[] = [];
  let chars = 0;
  for (const s of splitSentences(text, ctx.locale)) {
    if (kept.length >= MAX_CHAT_SENTENCES) break;
    if (!chatSentenceOk(s, known, ctx.locale)) continue;
    if (chars + s.length > MAX_CHAT_CHARS) break;
    chars += s.length + 1;
    kept.push(s);
  }
  return kept;
}

function chatSentenceOk(s: string, known: Set<string>, locale: Locale): boolean {
  if (countWords(s) > MAX_CHAT_WORDS) return false;
  const words = tokens(s);
  const lower = words.map((w) => w.toLowerCase());
  if (lower.some((w) => MED_WORDS.includes(w))) return false;
  if (s.trim().endsWith("?") && WH_WORDS[locale].includes(lower[0] ?? "")) return false;
  return words.every((w, i) => {
    const l = w.toLowerCase();
    const isNumber = /\d/.test(w) || NUMBER_WORDS.includes(l);
    // "I" and "I'm" are not names.
    const isName = /^\p{Lu}/u.test(w) && !/^i(?:'|$)/.test(l) && !(i === 0 && STARTERS.includes(l));
    return !(isNumber || isName) || known.has(l);
  });
}
