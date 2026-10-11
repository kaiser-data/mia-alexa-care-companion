import { phraseIds, phraseText, splitSentences, type Locale, type PhraseKind } from "@mia/shared";
import type { ToolInfo } from "./mcp";

/** Spec §8: at most four short sentences per answer (tool sentences are never cut). */
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

/**
 * Builds what Mia says: lead (feeling wins over opener), tool sentences verbatim,
 * then a question (or a closing if there is no question). Cap of four: the lead goes first,
 * then the question/closing; tool sentences are never cut.
 * Nothing to say → the call offer.
 */
export function compose(toolSays: string[], choice: RespondInput | null, ctx: ComposeContext): string[] {
  const c = choice ?? {};
  const tools = toolSays.flatMap((s) => splitSentences(s, ctx.locale));
  const lead = pick(c.feeling, "feeling", ctx) ?? pick(c.opener, "opener", ctx);
  const end = pick(c.question, "question", ctx) ?? pick(c.closing, "closing", ctx);

  let leads = lead ? [lead] : [];
  let ends = end ? [end] : [];
  const total = () => leads.length + tools.length + ends.length;
  if (total() > MAX_SENTENCES) leads = [];
  if (total() > MAX_SENTENCES) ends = [];

  const out = [...leads, ...tools, ...ends];
  if (out.length) return out;
  return [phraseText("offer_call", ctx.locale, { name: ctx.name, carer: ctx.carer })!];
}
