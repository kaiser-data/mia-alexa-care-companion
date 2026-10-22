import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectOverdose, templates, type Profile } from "@mia/shared";
import { capTextEnd, logEvent, OUTPUT_SHAPE, toResult, writeHold, type ToolContext } from "./runtime";

export function registerProblemTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool("report_problem", {
    title: "Help — something is wrong",
    description:
      "ALWAYS use immediately when she asks for help, says she fell, is hurt, in pain, cannot get up, feels very unwell, or is lost. " +
      "Alerts the family at once. Do not ask follow-up questions first. " +
      "Examples: 'Help!', 'I fell.', 'It hurts.', 'I can't get up.', 'Hilfe!', 'Ich bin gestürzt.', 'Mir tut es weh.'.",
    inputSchema: { what: z.string().optional().describe("Her own words about what happened") },
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false },
  }, async ({ what: rawWhat }) => {
    // Her last words are where "I fell" is most likely to be.
    const what = rawWhat === undefined ? undefined : capTextEnd(rawWhat, 200);
    // The moment she spoke: the alert, the hold and the log carry it, however long the mail takes (23:59:59 stays today).
    const at = ctx.now().toISOString();
    // Pills taken twice: no dose is prompted for the rest of that day. Started at once, beside the alert: neither waits
    // for the other. Decided on her whole words: the stored text keeps only the last 200 characters.
    const hold = rawWhat && detectOverdose(rawWhat)
      ? Promise.resolve().then(() => writeHold(ctx, at))
      : Promise.resolve();
    // Deliberately not run(): the alert must not depend on reading the profile's event log.
    let p: Profile | null = null;
    try { p = await ctx.store.getProfile(ctx.profileId); } catch (err) { console.error("[mia] distress: profile read failed:", err); }
    const T = templates(p?.locale ?? "en-US");
    const carer = p?.carerName ?? "your family";
    let alerted = false;
    try {
      await ctx.alerts.raise({
        profileId: ctx.profileId, rule: "distress", severity: "high",
        message: `${p?.preferredName ?? "Your family member"} asked for help${what ? `: "${what}"` : ""}.`,
        at,
      });
      // Without a mailer the alert is only stored: she is told to call for help, never that the carer knows.
      alerted = ctx.alerts.notifies === true;
      if (!alerted) console.error("[mia] distress alert stored but nobody was told: alert email is off");
    } catch (err) { console.error("[mia] distress alert failed:", err); }
    await hold;
    await logEvent(ctx, "distress", what ? { what } : undefined, at)
      .catch((err) => console.error("[mia] distress log failed:", err));
    // Without a profile there is no carer name to start the follow-up sentence with.
    const say = !alerted ? [T.distressFailed(carer)] : p ? [T.distressAck(carer), T.distressFollow(carer)] : [T.distressAck(carer)];
    await ctx.store.setLastSay(ctx.profileId, say).catch(() => undefined);
    return toResult({ facts: { alerted }, say, verbatim: true });
  });
}
