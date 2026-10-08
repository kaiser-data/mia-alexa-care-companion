import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { templates, todayView, toMinutes } from "@mia/shared";
import { logEvent, OUTPUT_SHAPE, run, type ToolContext } from "./runtime";

export function registerOutingTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool("report_leaving", {
    title: "I'm going out",
    description:
      "Use when she says she is leaving the house or going to her group. Records that she left so the family knows when to expect her back. " +
      "Examples: 'I'm going to my group now.', 'I'm off.', 'Ich gehe jetzt los.', 'Ich gehe zur Gruppe.'.",
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false },
  }, async () => run(ctx, async (p) => {
    const T = templates(p.locale);
    const v = todayView(p, ctx.now());
    const appt = v.appointments.find((a) => toMinutes(a.end) > v.minutes);
    await logEvent(ctx, "left_home", appt ? { appointmentId: appt.id } : undefined);
    return { facts: { appointment: appt?.name ?? null, expectedReturn: appt?.expectedReturn ?? null }, say: [T.leavingOk(), T.keysCheck()], verbatim: true };
  }));

  server.registerTool("report_home", {
    title: "I'm home",
    description:
      "Use when she says she is back home. Examples: 'I'm home.', 'I'm back.', 'Ich bin wieder da.', 'Ich bin zu Hause.'.",
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false },
  }, async () => run(ctx, async (p) => {
    const T = templates(p.locale);
    await logEvent(ctx, "arrived_home");
    return { facts: {}, say: [T.welcomeHome(p.preferredName), T.niceTime()], verbatim: true };
  }));
}
