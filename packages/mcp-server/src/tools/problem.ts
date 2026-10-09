import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { templates, type Profile } from "@mia/shared";
import { capText, logEvent, OUTPUT_SHAPE, toResult, type ToolContext } from "./runtime";

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
    const what = rawWhat === undefined ? undefined : capText(rawWhat, 200);
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
        at: ctx.now().toISOString(),
      });
      alerted = true;
    } catch (err) { console.error("[mia] distress alert failed:", err); }
    await logEvent(ctx, "distress", what ? { what } : undefined)
      .catch((err) => console.error("[mia] distress log failed:", err));
    // Without a profile there is no carer name to start the follow-up sentence with.
    const say = !alerted ? [T.distressFailed(carer)] : p ? [T.distressAck(carer), T.distressFollow(carer)] : [T.distressAck(carer)];
    await ctx.store.setLastSay(ctx.profileId, say).catch(() => undefined);
    return toResult({ facts: { alerted }, say, verbatim: true });
  });
}
