import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { templates, timeWords, toMinutes, type Appointment, type CareEvent, type EventType, type Locale, type Profile } from "@mia/shared";
import type { AlertSink } from "../alerts";
import type { Store } from "../store/store";
import type { WeatherProvider } from "../weather";

export interface ToolContext {
  store: Store;
  profileId: string;
  now: () => Date;
  alerts: AlertSink;
  /** optional: adds a weather sentence to the first preparation step */
  weather?: WeatherProvider;
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
  "Ask one easy yes/no question at a time. Never correct her. End by offering to ask the carer to call. " +
  "Use only the facts in topics; never add names, dates or events.";

export const OUTPUT_SHAPE = {
  facts: z.record(z.string(), z.unknown()),
  say: z.array(z.string()),
  verbatim: z.boolean(),
  guidance: z.string(),
};

const LOOKBACK_MS = 36 * 3600 * 1000;

/** Cut free text to at most n characters without splitting an emoji. */
export function capText(s: string, n: number): string {
  return Array.from(s).slice(0, n).join("");
}

/** Keep the last n characters (without splitting an emoji): the most recent words matter most. */
export function capTextEnd(s: string, n: number): string {
  return Array.from(s).slice(-n).join("");
}

/** `at` defaults to now; pass the moment she spoke when the event is written after something slow (a mail). */
export async function logEvent(ctx: ToolContext, type: EventType, detail?: Record<string, string>, at?: string): Promise<void> {
  await ctx.store.addEvent({ profileId: ctx.profileId, type, at: at ?? ctx.now().toISOString(), ...(detail ? { detail } : {}) });
}

/** Pill holds whose write failed, per store: they still hold the pills and are written on the next read (fail closed). */
const pendingHolds = new WeakMap<Store, CareEvent[]>();

/** Pills taken twice: no dose is prompted for the rest of that day. A failed write is kept in memory, never dropped. */
export async function writeHold(ctx: ToolContext, at: string): Promise<void> {
  const e: CareEvent = { profileId: ctx.profileId, type: "med_hold", at, detail: { reason: "overdose_report" } };
  try { await ctx.store.addEvent(e); } catch (err) {
    console.error("[mia] medication hold not written, kept in memory:", err);
    pendingHolds.set(ctx.store, [...(pendingHolds.get(ctx.store) ?? []), e]);
  }
}

/** The event log since `since`, with any unwritten holds; each one is written again first. */
export async function readEvents(ctx: ToolContext, since: string): Promise<CareEvent[]> {
  const pending = pendingHolds.get(ctx.store);
  pendingHolds.delete(ctx.store);
  for (const e of pending ?? []) await writeHold({ ...ctx, profileId: e.profileId }, e.at);
  const unwritten = (pendingHolds.get(ctx.store) ?? []).filter((e) => e.profileId === ctx.profileId && e.at >= since);
  return [...await ctx.store.eventsSince(ctx.profileId, since), ...unwritten];
}

export function toResult(r: MiaResult): CallToolResult {
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
    const result = await fn(profile, await readEvents(ctx, since));
    if (opts.remember !== false && result.say.length) await ctx.store.setLastSay(ctx.profileId, result.say);
    return toResult(result);
  } catch (err) {
    console.error("[mia] tool failed:", err);
    const T = templates(profile?.locale ?? "en-US");
    return toResult({ facts: { error: "unavailable" }, say: [T.systemError(profile?.carerName ?? "Your family")], verbatim: true });
  }
}

/** One sentence about an appointment today, depending on the time. */
export function appointmentLine(a: Appointment, nowMinutes: number, locale: Locale, { named = true }: { named?: boolean } = {}): string {
  const T = templates(locale);
  if (a.travelMode === "alone" && a.leaveBy && nowMinutes < toMinutes(a.leaveBy)) {
    return named ? T.leaveFor(a.name, timeWords(a.leaveBy, locale)) : T.leaveAt(timeWords(a.leaveBy, locale));
  }
  if (nowMinutes < toMinutes(a.start)) return T.apptAt(a.name, timeWords(a.start, locale));
  return T.apptUntil(a.name, timeWords(a.end, locale));
}
