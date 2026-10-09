import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { templates } from "@mia/shared";
import { logEvent, OUTPUT_SHAPE, run, type ToolContext } from "./runtime";

export function registerMusicTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool("play_music", {
    title: "Play her favourite music",
    description:
      "Use when she says yes to music, or asks for music, a song or her favourite singer. The voice device then plays it. " +
      "Examples: 'Yes, play some music.', 'Can I hear Frank Sinatra?', 'Spiel mir Musik vor.', 'Ja, gerne Musik.'.",
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false },
  }, async () => run(ctx, async (p) => {
    const T = templates(p.locale);
    if (!p.favouriteMusic) {
      await logEvent(ctx, "unknown_question", { topic: "music" });
      return { facts: { action: null }, say: [T.dontKnow(p.carerName)], verbatim: true };
    }
    await logEvent(ctx, "music_played", { artist: p.favouriteMusic });
    return { facts: { action: "play_music", artist: p.favouriteMusic }, say: [T.musicStart(p.favouriteMusic)], verbatim: true };
  }));
}
