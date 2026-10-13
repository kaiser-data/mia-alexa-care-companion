import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { templates, type Profile } from "@mia/shared";
import { capTextEnd, logEvent, OUTPUT_SHAPE, toResult, type ToolContext } from "./runtime";

export function registerHealthTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool("ask_carer_about_health", {
    title: "A health or medicine question for the carer",
    description:
      "Use whenever she asks a health or medicine question Mia must not answer: side effects, other medicines or painkillers, " +
      "whether to stop, skip, take extra or double pills, feeling unwell because of her pills, food or alcohol with pills. " +
      "Mia never answers it: she says so, suggests asking the carer, and the carer is told. " +
      "A fall, pain, being hurt or feeling very unwell is report_problem instead. " +
      "Examples: 'My pills make me dizzy, should I take them?', 'Can I take an aspirin?', 'Can I have a glass of wine with my pills?', " +
      "'Darf ich eine Kopfschmerztablette nehmen?', 'Mir ist schwindelig von den Tabletten, soll ich sie nehmen?'.",
    inputSchema: { what: z.string().optional().describe("Her own words, in her language") },
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false },
  }, async ({ what: rawWhat }) => {
    const what = rawWhat === undefined ? undefined : capTextEnd(rawWhat, 200);
    // Like report_problem, not run(): the carer flag must not depend on reading the event log, and nothing here throws.
    let p: Profile | null = null;
    try { p = await ctx.store.getProfile(ctx.profileId); } catch (err) { console.error("[mia] health question: profile read failed:", err); }
    const T = templates(p?.locale ?? "en-US");
    const carer = p?.carerName ?? "your family";
    let alerted = false;
    try {
      await ctx.alerts.raise({
        profileId: ctx.profileId, rule: "health_question", severity: "medium",
        message: `${p?.preferredName ?? "Your family member"} has a health question${what ? `: "${what}"` : ""}.`,
        at: ctx.now().toISOString(),
      });
      alerted = true;
    } catch (err) { console.error("[mia] health question alert failed:", err); }
    await logEvent(ctx, "unknown_question", { topic: "health", query: what ?? "" })
      .catch((err) => console.error("[mia] health question log failed:", err));
    // "Let's ask Tom first." is a suggestion, true whether or not the alert went out: it never claims Tom was told.
    const say = [T.healthAsk(), T.askCarerFirst(carer)];
    await ctx.store.setLastSay(ctx.profileId, say).catch(() => undefined);
    return toResult({ facts: { alerted }, say, verbatim: true });
  });
}
