import { phraseIds, phraseText, splitSentences, templates, type Locale, type PhraseKind } from "@mia/shared";
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

/** Lower comes first: a cry for help, then pills, then side-effects, then comfort, then everything else in call order. */
const MEDS = 1;
const SIDE_EFFECTS = 1.5;
const PRIORITY: Record<string, number> = {
  report_problem: 0,
  get_medication_status: MEDS, confirm_medication: MEDS,
  // Answers that confirm something that already happened: right after the pills, never ahead of them.
  request_call: SIDE_EFFECTS, play_music: SIDE_EFFECTS, report_leaving: SIDE_EFFECTS, report_home: SIDE_EFFECTS,
  comfort_me: 2, night_reassurance: 2,
};
const OTHERS = 3;
/** Openers that may stand without a tool answer: a greeting is not a "yes". */
const GREETINGS = ["hello", "good_morning", "good_evening"];

const isQuestion = (s: string) => s.trimEnd().endsWith("?");

/**
 * Builds what Mia says. Invariants (checked on every output by the table test in compose.test.ts):
 * never silence; at most four sentences; at most one question, always the last sentence;
 * never a call offer after request_call ran; the pills are never dropped or displaced by side-effect answers.
 *
 * - Order: report_problem, then the pills (get_medication_status, confirm_medication), then the side-effect answers
 *   (request_call, play_music, report_leaving, report_home), then comfort_me / night_reassurance, then the rest in call order.
 * - Tool answers are added whole while they fit; a later smaller one may still fit. If the first answer alone is too long,
 *   it is spoken alone. When the pills (3) and report_home (2) cannot both fit, the pills win and report_home is dropped.
 * - One question: a tool answer's own question is taken out of its place and asked last. If several kept answers ask,
 *   only the highest-ranked one's question is asked; the others' facts are kept, their questions dropped.
 *   A tool question replaces the picked question and the closing.
 * - The question slot is reserved only when a question will really be asked. A picked (not tool) question gives its
 *   reserved slot up for the first answer and for a pills or side-effect answer that would otherwise not fit.
 *   A closing reserves nothing and follows only if there is room.
 * - After request_call no call offer is made: neither the picked offer_call nor a tool's own call offer (the shared
 *   callOffer template, e.g. from comfort_me).
 * - The lead (feeling wins over opener) is added only if it still fits, and not when it repeats the first tool sentence.
 * - No tool spoke: an optional feeling or greeting, then the question, closing, or a default
 *   ("anything else" after a greeting, otherwise the call offer). "Of course" alone would sound like a yes, so it is dropped.
 */
export function compose(toolSays: ToolSay[], choice: RespondInput | null, ctx: ComposeContext): string[] {
  const c = choice ?? {};
  // A call that was just requested is never offered again.
  const requestedCall = toolSays.some((g) => g.tool === "request_call");
  const callOffer = templates(ctx.locale).callOffer(ctx.carer);
  let picked = requestedCall && c.question === "offer_call" ? null : pick(c.question, "question", ctx);
  const closing = pick(c.closing, "closing", ctx);
  const phrase = (id: string) => phraseText(id, ctx.locale, { name: ctx.name, carer: ctx.carer })!;

  const groups = toolSays
    .map((g, i) => ({
      i,
      rank: PRIORITY[g.tool] ?? OTHERS,
      sentences: g.says.flatMap((s) => splitSentences(s, ctx.locale)).filter((s) => !(requestedCall && s === callOffer)),
    }))
    .filter((g) => g.sentences.length > 0)
    .sort((a, b) => a.rank - b.rank || a.i - b.i);

  if (!groups.length) {
    const feeling = pick(c.feeling, "feeling", ctx);
    const greeting = feeling ? null : GREETINGS.includes(c.opener ?? "") ? pick(c.opener, "opener", ctx) : null;
    const lead = feeling ?? greeting;
    return [...(lead ? [lead] : []), picked ?? closing ?? phrase(greeting || requestedCall ? "anything_else" : "offer_call")];
  }

  if (groups[0]!.sentences.length > MAX_SENTENCES) return groups[0]!.sentences;

  const facts: string[] = [];
  let asked: string | null = null; // a tool's own question, asked last
  for (const [n, g] of groups.entries()) {
    const own = g.sentences.filter(isQuestion);
    const gFacts = g.sentences.filter((s) => !isQuestion(s));
    const ask: string | null = asked ?? own[0] ?? null;
    const cost = (withPicked: string | null) => facts.length + gFacts.length + (ask ?? withPicked ? 1 : 0);
    if (cost(picked) > MAX_SENTENCES) {
      // A merely reserved slot gives way to the first answer, the pills and a side-effect answer.
      if (asked || !picked || !(n === 0 || g.rank <= SIDE_EFFECTS) || cost(null) > MAX_SENTENCES) continue;
      picked = null;
    }
    facts.push(...gFacts);
    asked = ask;
  }

  const question = asked ?? picked;
  const out = question ? [...facts, question] : closing && facts.length < MAX_SENTENCES ? [...facts, closing] : facts;
  const lead = pick(c.feeling, "feeling", ctx) ?? pick(c.opener, "opener", ctx);
  if (lead && lead !== out[0] && out.length < MAX_SENTENCES) out.unshift(lead);
  return out;
}
