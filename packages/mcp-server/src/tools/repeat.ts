import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { todayResult } from "./orientation";
import { logEvent, OUTPUT_SHAPE, run, type ToolContext } from "./runtime";

export function registerRepeatTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool("repeat_last", {
    title: "Say that again",
    description:
      "Use when she did not hear or understand and asks to repeat. Repeats the last answer word for word, slower. " +
      "Examples: 'Pardon?', 'What?', 'Say that again.', 'Wie bitte?', 'Was hast du gesagt?'.",
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false },
  }, async () => run(ctx, async (p) => {
    const last = await ctx.store.getLastSay(ctx.profileId);
    await logEvent(ctx, "repeat_asked");
    if (!last) return todayResult(ctx, p);
    return { facts: { slower: true }, say: last, verbatim: true };
  }, { remember: false }));
}
