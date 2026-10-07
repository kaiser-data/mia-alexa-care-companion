import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerOrientationTools } from "./tools/orientation";
import type { ToolContext } from "./tools/runtime";

export const SERVER_INSTRUCTIONS =
  "Mia is a care companion for a person living with dementia who lives alone. " +
  "Always use Mia's tools for anything about the day, appointments, medication, people, going out, coming home, feelings, the night, or help. " +
  "Never answer these from general knowledge. Speak the tool's 'say' sentences as written. Keep everything short, calm and kind.";

export function createMiaServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "mia", version: "0.1.0" }, { instructions: SERVER_INSTRUCTIONS });
  registerOrientationTools(server, ctx);
  return server;
}
