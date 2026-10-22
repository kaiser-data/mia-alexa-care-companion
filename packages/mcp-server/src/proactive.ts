import { proactivePrompt, type ProactivePrompt } from "@mia/shared";
import { logEvent, readEvents, type ToolContext } from "./tools/runtime";

const LOOKBACK_MS = 36 * 3600 * 1000;

/**
 * Care Mode demo: the add-on tells the voice device what to say first. Logged so each prompt is spoken once.
 * Contract: a prompt counts as spoken when it is handed out (demo simplification; one device, serialised
 * requests). A production version would confirm playback with a separate acknowledgement.
 */
export async function nextProactive(ctx: ToolContext): Promise<ProactivePrompt | null> {
  const p = await ctx.store.getProfile(ctx.profileId);
  if (!p) return null;
  const now = ctx.now();
  const events = await readEvents(ctx, new Date(now.getTime() - LOOKBACK_MS).toISOString());
  const prompt = proactivePrompt(p, events, now);
  if (!prompt) return null;
  await logEvent(ctx, "proactive_spoken", { promptId: prompt.id });
  await ctx.store.setLastSay(ctx.profileId, prompt.say);
  return prompt;
}
