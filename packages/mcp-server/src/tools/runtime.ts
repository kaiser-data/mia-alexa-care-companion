import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { templates, timeWords, toMinutes, type Appointment, type CareEvent, type EventType, type Locale, type Profile } from "@mia/shared";
import type { AlertSink } from "../alerts";
import type { Store } from "../store/store";

export interface ToolContext {
  store: Store;
  profileId: string;
  now: () => Date;
  alerts: AlertSink;
}

export interface MiaResult {
  facts: Record<string, unknown>;
  say: string[];
  verbatim: boolean;
  /** text content when `say` is empty (non-verbatim tools) */
  text?: string;
}

export const VERBATIM_GUIDANCE =
  "Speak the 'say' sentences exactly as written, in this order. You may add one short warm lead-in of at most five words. " +
  "Do not add facts. No medical advice. Never mention that a question was asked before.";

export const CHAT_GUIDANCE =
  "Have a warm, simple conversation about the suggested topic. Use short sentences of at most twelve words. " +
  "Ask one easy yes/no question at a time. Never correct her. End by offering to ask the carer to call.";

export const OUTPUT_SHAPE = {
  facts: z.record(z.string(), z.unknown()),
  say: z.array(z.string()),
  verbatim: z.boolean(),
  guidance: z.string(),
};

const LOOKBACK_MS = 36 * 3600 * 1000;

export async function logEvent(ctx: ToolContext, type: EventType, detail?: Record<string, string>): Promise<void> {
  await ctx.store.addEvent({ profileId: ctx.profileId, type, at: ctx.now().toISOString(), ...(detail ? { detail } : {}) });
}

function toResult(r: MiaResult): CallToolResult {
  return {
    content: [{ type: "text", text: r.say.length ? r.say.join(" ") : (r.text ?? "") }],
    structuredContent: { facts: r.facts, say: r.say, verbatim: r.verbatim, guidance: r.verbatim ? VERBATIM_GUIDANCE : CHAT_GUIDANCE },
  };
}

export async function run(
  ctx: ToolContext,
  fn: (p: Profile, events: CareEvent[]) => Promise<MiaResult>,
  opts: { remember?: boolean } = {},
): Promise<CallToolResult> {
  let profile: Profile | null = null;
  try {
    profile = await ctx.store.getProfile(ctx.profileId);
    if (!profile) throw new Error(`profile ${ctx.profileId} not found`);
    const since = new Date(ctx.now().getTime() - LOOKBACK_MS).toISOString();
    const result = await fn(profile, await ctx.store.eventsSince(ctx.profileId, since));
    if (opts.remember !== false && result.say.length) await ctx.store.setLastSay(ctx.profileId, result.say);
    return toResult(result);
  } catch (err) {
    console.error("[mia] tool failed:", err);
    const T = templates(profile?.locale ?? "en-US");
    return toResult({ facts: { error: "unavailable" }, say: [T.systemError(profile?.carerName ?? "Your family")], verbatim: true });
  }
}

/** One sentence about an appointment today, depending on the time. */
export function appointmentLine(a: Appointment, nowMinutes: number, locale: Locale): string {
  const T = templates(locale);
  if (a.travelMode === "alone" && a.leaveBy && nowMinutes < toMinutes(a.leaveBy)) return T.leaveFor(a.name, timeWords(a.leaveBy, locale));
  if (nowMinutes < toMinutes(a.start)) return T.apptAt(a.name, timeWords(a.start, locale));
  return T.apptUntil(a.name, timeWords(a.end, locale));
}
