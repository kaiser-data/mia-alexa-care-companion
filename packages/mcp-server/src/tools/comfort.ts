import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { localParts, templates } from "@mia/shared";
import { logEvent, OUTPUT_SHAPE, run, type ToolContext } from "./runtime";

export function registerComfortTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool("comfort_me", {
    title: "I'm scared / I feel strange",
    description:
      "Use when she sounds anxious, scared, confused, sad or says she feels strange or wants to go home. " +
      "Gives the family's own comforting words and offers to ask the carer to call. " +
      "Examples: 'I'm scared.', 'Something is wrong.', 'I want to go home.', 'Ich habe Angst.', 'Mir ist komisch.'.",
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false },
  }, async () => run(ctx, async (p) => {
    const T = templates(p.locale);
    await logEvent(ctx, "anxious");
    return {
      facts: { comfortNotes: p.comfortNotes },
      say: [p.comfortNotes[0] ?? T.safeAtHome(), T.callOffer(p.carerName)],
      verbatim: true,
    };
  }));

  server.registerTool("request_call", {
    title: "Please ask my family to call",
    description:
      "Use when she says yes to a call offer, or asks for her son, daughter or family to call her. Notifies the carer. " +
      "Examples: 'Yes, please.', 'I want to talk to Tom.', 'Can Tom call me?', 'Ja, bitte.', 'Tom soll mich anrufen.'.",
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false },
  }, async () => run(ctx, async (p) => {
    const T = templates(p.locale);
    await logEvent(ctx, "call_requested");
    await ctx.alerts.raise({ profileId: p.id, rule: "call_requested", severity: "medium", message: `${p.preferredName} would like a call.`, at: ctx.now().toISOString() });
    return { facts: {}, say: [T.callRequested(p.carerName)], verbatim: true };
  }));

  server.registerTool("chat_about_life", {
    title: "Talk with me",
    description:
      "Use when she is lonely, bored, or wants to talk. Returns topics from her own life story to chat about warmly. " +
      "Examples: 'I'm lonely.', 'Tell me something.', 'Talk to me.', 'Mir ist langweilig.', 'Erzähl mir was.'.",
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false },
  }, async () => run(ctx, async (p) => {
    await logEvent(ctx, "lonely");
    const dayIndex = Math.floor(Date.parse(`${localParts(ctx.now(), p.timezone).date}T00:00:00Z`) / 86_400_000);
    const suggestedTopic = p.lifeStory[dayIndex % p.lifeStory.length] ?? "";
    return {
      facts: { topics: p.lifeStory, suggestedTopic, carerName: p.carerName },
      say: [],
      verbatim: false,
      text: `Suggested topic: ${suggestedTopic}`,
    };
  }));
}
