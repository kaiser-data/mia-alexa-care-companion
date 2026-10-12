import { phraseIds, phraseText, splitSentences, type Locale, type PhraseKind } from "@mia/shared";
import type { ToolInfo } from "./mcp";

/** Spec §8: at most four short sentences per answer (one tool answer is never cut inside). */
export const MAX_SENTENCES = 4;

const slot = (kind: PhraseKind) => ({ type: "string", enum: ["none", ...phraseIds(kind)] });

/**
 * "Claude picks, doesn't write": the LLM ends every turn by choosing phrase ids here.
 * Defined by the voice gateway, not by the Mia MCP server; always sent last.
 */
export const RESPOND_TOOL: ToolInfo = {
  name: "respond",
  description: "Always finish your turn by calling this. Mia speaks the tool sentences you collected, wrapped in these phrases. You cannot write any sentence yourself; use \"none\" where nothing fits.",
  strict: true,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["opener", "feeling", "question", "closing"],
    properties: {
      opener: slot("opener"),
      feeling: slot("feeling"),
      question: slot("question"),
      closing: slot("closing"),
    },
  },
};

export interface RespondInput { opener?: string; feeling?: string; question?: string; closing?: string }

export interface ComposeContext {
  locale: Locale;
  name: string;
  carer: string;
}

/** Reads the respond input defensively: anything that is not a string counts as "none"; unknown keys are ignored. */
export function readRespond(input: Record<string, unknown>): RespondInput {
  const out: RespondInput = {};
  for (const k of ["opener", "feeling", "question", "closing"] as const) {
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

/** What one Mia tool call said, kept together: an answer is spoken whole or not at all. */
export interface ToolSay { tool: string; says: string[] }

/** Lower comes first: a cry for help, then pills, then comfort, then everything else in call order. */
const PRIORITY: Record<string, number> = {
  report_problem: 0,
  get_medication_status: 1, confirm_medication: 1,
  // Answers that confirm something that already happened: never cut in favour of a passive answer.
  request_call: 1, play_music: 1, report_leaving: 1, report_home: 1,
  comfort_me: 2, night_reassurance: 2,
};
const OTHERS = 3;
/** Openers that may stand without a tool answer: a greeting is not a "yes". */
const GREETINGS = ["hello", "good_morning", "good_evening"];

/**
 * Builds what Mia says, at most four sentences, the key answer first.
 * - Tool answers are ordered by priority and added whole while they fit; one is never cut inside.
 *   A question reserves its slot. If the first answer alone is too long, it is spoken alone.
 *   request_call, play_music, report_leaving and report_home rank with the pills; a group that does not fit is skipped.
 *   If the last kept sentence already asks a question, no picked question or closing follows; after request_call no call offer.
 * - The lead (feeling wins over opener) is added only if it still fits, and not when it repeats the first tool sentence.
 * - No tool spoke: an optional feeling or greeting, then the question, closing, or a default
 *   ("anything else" after a greeting, otherwise the call offer). "Of course" alone would sound like a yes, so it is dropped.
 */
export function compose(toolSays: ToolSay[], choice: RespondInput | null, ctx: ComposeContext): string[] {
  const c = choice ?? {};
  // A call that was just requested is never offered again.
  const requestedCall = toolSays.some((g) => g.tool === "request_call");
  const question = requestedCall && c.question === "offer_call" ? null : pick(c.question, "question", ctx);
  const end = question ?? pick(c.closing, "closing", ctx);
  const phrase = (id: string) => phraseText(id, ctx.locale, { name: ctx.name, carer: ctx.carer })!;

  const groups = toolSays
    .map((g, i) => ({ i, rank: PRIORITY[g.tool] ?? OTHERS, sentences: g.says.flatMap((s) => splitSentences(s, ctx.locale)) }))
    .filter((g) => g.sentences.length > 0)
    .sort((a, b) => a.rank - b.rank || a.i - b.i);

  if (!groups.length) {
    const feeling = pick(c.feeling, "feeling", ctx);
    const greeting = feeling ? null : GREETINGS.includes(c.opener ?? "") ? pick(c.opener, "opener", ctx) : null;
    const lead = feeling ?? greeting;
    return [...(lead ? [lead] : []), end ?? phrase(greeting || requestedCall ? "anything_else" : "offer_call")];
  }

  const budget = MAX_SENTENCES - (question ? 1 : 0);
  const [first, ...rest] = groups;
  if (first!.sentences.length > budget) return first!.sentences;
  const tools = [...first!.sentences];
  for (const g of rest) {
    if (tools.length + g.sentences.length > budget) continue;
    tools.push(...g.sentences);
  }
  // At most one question, always last: a tool answer that already asks one gets no second.
  const endsAsking = tools.at(-1)!.trimEnd().endsWith("?");
  const out = end && !endsAsking && tools.length < MAX_SENTENCES ? [...tools, end] : tools;
  const lead = pick(c.feeling, "feeling", ctx) ?? pick(c.opener, "opener", ctx);
  if (lead && lead !== tools[0] && out.length < MAX_SENTENCES) out.unshift(lead);
  return out;
}
