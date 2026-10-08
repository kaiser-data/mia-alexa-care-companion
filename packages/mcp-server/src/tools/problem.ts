import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { templates } from "@mia/shared";
import { logEvent, OUTPUT_SHAPE, run, type ToolContext } from "./runtime";

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
  }, async ({ what }) => run(ctx, async (p) => {
    const T = templates(p.locale);
    await logEvent(ctx, "distress", what ? { what } : undefined);
    await ctx.alerts.raise({
      profileId: p.id, rule: "distress", severity: "high",
      message: `${p.preferredName} asked for help${what ? `: "${what}"` : ""}.`,
      at: ctx.now().toISOString(),
    });
    return { facts: { alerted: true }, say: [T.distressAck(p.carerName), T.distressFollow(p.carerName)], verbatim: true };
  }));
}
