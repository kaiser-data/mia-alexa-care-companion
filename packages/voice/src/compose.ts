import { phraseIds, phraseText, splitSentences, templates, weekdayName, type Locale, type PhraseKind, type Weekday } from "@mia/shared";
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

/**
 * Lower comes first: a cry for help, a health question for the carer, then pills, then side-effects, then comfort,
 * then everything else in call order.
 */
const MEDS = 1;
const SIDE_EFFECTS = 1.5;
const PRIORITY: Record<string, number> = {
  report_problem: 0,
  // "I can't answer that one. Let's ask Tom first." is a pill fact: whole, never cut, and ahead of a "take it now".
  ask_carer_about_health: 0.5,
  get_medication_status: MEDS, confirm_medication: MEDS,
  // Answers that confirm something that already happened: right after the pills, never ahead of them.
  request_call: SIDE_EFFECTS, play_music: SIDE_EFFECTS, report_leaving: SIDE_EFFECTS, report_home: SIDE_EFFECTS,
  comfort_me: 2, night_reassurance: 2,
};
const OTHERS = 3;
/** Beside a health answer a side-effect confirmation ("I've asked Tom to call you.") comes before the other pill facts. */
const SIDE_BEFORE_PILLS = 0.75;
const SIDE_EFFECT_TOOLS = new Set(Object.keys(PRIORITY).filter((t) => PRIORITY[t] === SIDE_EFFECTS));
/** Openers that may stand without a tool answer: a greeting is not a "yes". */
const GREETINGS = ["hello", "good_morning", "good_evening"];
/**
 * Answers that only a greeting may lead: "Of course, Rose." or "I'm glad." before "You took your morning pills…" or
 * "I can't answer that one." is heard as the answer to "Should I take…?".
 */
const NO_LEAD = new Set(["get_medication_status", "confirm_medication", "ask_carer_about_health"]);

const isQuestion = (s: string) => s.trimEnd().endsWith("?");
/** A sentence made by one template with one argument: the template's text around the argument. */
const madeBy = (template: (x: string) => string) => {
  const [head, tail] = template("\u0000").split("\u0000") as [string, string];
  return (s: string) => s.length > head.length + tail.length && s.startsWith(head) && s.endsWith(tail);
};
/**
 * The pill tool's "take it now" lines: "Now it's time for your morning pills." and "That's the small white pill…".
 * Beside a health question they are never spoken: she asked whether to take them, and only the carer decides.
 */
const dueLines = (locale: Locale) => {
  const T = templates(locale);
  const due = madeBy(T.medDue);
  const is = madeBy(T.medIs);
  return (s: string) => due(s) || is(s);
};
/**
 * Lines that only repeat the weekday just said, the first thing given up when space is short: get_today's closing
 * "Today is Sunday." (the shared repeatDay template) and get_next_appointment's "On Monday." (the shared onDay template).
 */
const repeatDays = (locale: Locale) => {
  const T = templates(locale);
  const days = ([1, 2, 3, 4, 5, 6, 7] as Weekday[]).map((w) => weekdayName(w, locale));
  return new Set(days.flatMap((d) => [T.repeatDay(d), T.onDay(d)]));
};

/**
 * Builds what Mia says. Invariants (checked on every output by the table test in compose.test.ts):
 * never silence; at most four sentences; beside report_problem no health answer; beside ask_carer_about_health never a due-dose line (medDue / medIs); at most one question, always the last sentence, right after its own tool's
 * facts; never a call offer after request_call ran; the pills are never dropped or displaced by side-effect answers;
 * a side-effect confirmation is never dropped for a question.
 *
 * One rule decides what is spoken: fill four places in priority order, then say the kept parts in rank order.
 * 1. Tool answers are walked in rank order: report_problem, ask_carer_about_health, the pills (get_medication_status, confirm_medication),
 *    the side-effects (request_call, play_music, report_leaving, report_home; beside ask_carer_about_health they come
 *    before the pills, so "I've asked Tom to call you." is always heard), comfort_me / night_reassurance, then the
 *    rest in call order. Each answer's facts (its sentences without its question) are kept whole or not at all;
 *    a later smaller answer may still fit. A fact an earlier kept answer already says takes no place and is spoken once.
 *    - The first answer and every answer up to the side-effects count only their facts: no question keeps them out.
 *    - comfort and the rest must also leave the place for a tool's own question, if one will be asked. A question
 *      the LLM picked never keeps a place free: a fact she asked for beats "Can I help with anything else?".
 *    - If the first answer's facts alone exceed four, it is spoken alone, whole.
 * 2. The question takes the next place if one is free: the own question of the first kept answer that has one
 *    (a tool question replaces the picked one), else the picked question. Otherwise no question is asked at all.
 *    After request_call no call offer is made: neither the picked offer_call nor a tool's own call offer
 *    (the shared callOffer template, e.g. from comfort_me).
 * 3. Then, only while places are free and only when no answer was skipped: the repeated days (get_today's
 *    "Today is Sunday." and get_next_appointment's "On Monday.", the shared repeatDay and onDay templates, not counted
 *    in step 1); then the closing (only without a question), then the lead (feeling wins over opener; not when it
 *    repeats the first sentence; beside a pill or health answer only a greeting). So a repeated day is the first thing given up, and either tool alone still speaks
 *    all three sentences. No sentence is spoken twice.
 * Order: the kept answers in rank order; an answer whose question is asked moves last, whole, so its question
 * follows its own facts ("Do you remember that?" after the life-story sentence). The pills never ask, so they stay first.
 * No tool spoke: an optional feeling or greeting, then the question, closing, or a default
 * ("anything else" after a greeting, otherwise the call offer). "Of course" alone would sound like a yes, so it is dropped.
 */
export function compose(toolSays: ToolSay[], choice: RespondInput | null, ctx: ComposeContext): string[] {
  const c = choice ?? {};
  // A call that was just requested is never offered again.
  const requestedCall = toolSays.some((g) => g.tool === "request_call");
  const callOffer = templates(ctx.locale).callOffer(ctx.carer);
  const picked = requestedCall && c.question === "offer_call" ? null : pick(c.question, "question", ctx);
  const closing = pick(c.closing, "closing", ctx);
  const phrase = (id: string) => phraseText(id, ctx.locale, { name: ctx.name, carer: ctx.carer })!;

  const repeats = repeatDays(ctx.locale);
  // A health question for the carer ran: the carer decides about the dose, so no "take it now" is spoken at all.
  const askedCarer = toolSays.some((g) => g.tool === "ask_carer_about_health");
  const isDue = dueLines(ctx.locale);
  // A cry for help wins: beside report_problem the health answer is not spoken ("I couldn't reach Tom. Please call for
  // help." must not be followed by "Let's ask Tom first."). Its carer flag still went out, and its due-line rule still holds.
  const distress = toolSays.some((g) => g.tool === "report_problem");
  const groups = toolSays
    .filter((g) => !(distress && g.tool === "ask_carer_about_health"))
    .map((g, i) => {
      const sentences = g.says.flatMap((s) => splitSentences(s, ctx.locale))
        .filter((s) => !(requestedCall && s === callOffer))
        .filter((s) => !(askedCarer && g.tool === "get_medication_status" && isDue(s)));
      const statements = sentences.filter((s) => !isQuestion(s));
      return {
        i, tool: g.tool, rank: askedCarer && SIDE_EFFECT_TOOLS.has(g.tool) ? SIDE_BEFORE_PILLS : PRIORITY[g.tool] ?? OTHERS, statements,
        facts: statements.filter((s) => !repeats.has(s)), question: sentences.find(isQuestion) ?? null,
      };
    })
    .filter((g) => g.statements.length > 0 || g.question)
    .sort((a, b) => a.rank - b.rank || a.i - b.i);

  if (!groups.length) {
    const feeling = pick(c.feeling, "feeling", ctx);
    const greeting = feeling ? null : GREETINGS.includes(c.opener ?? "") ? pick(c.opener, "opener", ctx) : null;
    const lead = feeling ?? greeting;
    return [...(lead ? [lead] : []), picked ?? closing ?? phrase(greeting || requestedCall ? "anything_else" : "offer_call")];
  }

  if (groups[0]!.facts.length > MAX_SENTENCES) return groups[0]!.statements;

  // 1. The answers' facts. A fact another kept answer already says is spoken once and takes no place.
  const kept: typeof groups = [];
  const spoken = new Set<string>();
  let used = 0;
  let asking: (typeof groups)[number] | null = null;
  for (const [n, g] of groups.entries()) {
    const fresh = [...new Set(g.facts.filter((s) => !spoken.has(s)))];
    // Only a tool's own question keeps a place free; a question the LLM picked never takes a place from a fact.
    const reserve = n === 0 || g.rank <= SIDE_EFFECTS ? 0 : (asking ?? g.question) ? 1 : 0;
    if (used + fresh.length + reserve > MAX_SENTENCES) continue;
    kept.push(g);
    used += fresh.length;
    for (const s of fresh) spoken.add(s);
    if (!asking && g.question) asking = g;
  }
  // A repeated day never takes a place that a skipped answer could not have.
  const allKept = kept.length === groups.length;

  // 2. The question, if a place is free.
  const question = used < MAX_SENTENCES ? (asking?.question ?? picked) : null;
  if (question) used++;
  // 3. The repeated day, the closing and the lead, only into free places.
  const order = question && asking ? [...kept.filter((g) => g !== asking), asking] : kept;
  const out: string[] = [];
  for (const g of order) {
    for (const s of g.statements) {
      if (out.includes(s)) continue;
      if (repeats.has(s)) {
        if (!allKept || used >= MAX_SENTENCES) continue;
        used++;
      }
      out.push(s);
    }
  }
  if (question) out.push(question);
  else if (closing && out.length < MAX_SENTENCES) out.push(closing);
  const plain = kept.some((g) => NO_LEAD.has(g.tool));
  const lead = plain
    ? (GREETINGS.includes(c.opener ?? "") ? pick(c.opener, "opener", ctx) : null)
    : pick(c.feeling, "feeling", ctx) ?? pick(c.opener, "opener", ctx);
  if (lead && lead !== out[0] && out.length < MAX_SENTENCES) out.unshift(lead);
  return out;
}
