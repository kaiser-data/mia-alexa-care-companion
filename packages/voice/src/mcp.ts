import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ProactivePrompt } from "@mia/shared";

export class MiaToolError extends Error {
  constructor(readonly tool: string, readonly text: string) {
    super(`Mia tool ${tool} failed: ${text}`);
    this.name = "MiaToolError";
  }
}

export interface ToolReply { say: string[]; facts: Record<string, unknown>; verbatim: boolean; guidance: string; text: string }
export interface ToolInfo { name: string; description: string; inputSchema: Record<string, unknown> }
export interface MiaClient {
  tools(): Promise<ToolInfo[]>;
  call(name: string, args?: Record<string, unknown>): Promise<ToolReply>;
  proactive(): Promise<ProactivePrompt | null>;
}
export interface MiaConnection { url: string; token: string; fetch?: typeof fetch }

/** The voice gateway's side of Mia: an MCP client, like Alexa+ would be, plus the Care Mode proactive endpoint. */
export async function connectMia(c: MiaConnection): Promise<MiaClient> {
  const fetchFn = c.fetch ?? fetch;
  const headers = { authorization: `Bearer ${c.token}` };
  const transport = new StreamableHTTPClientTransport(new URL(`${c.url}/mcp`), { fetch: fetchFn, requestInit: { headers } });
  const client = new Client({ name: "mia-voice", version: "0.1.0" });
  await client.connect(transport);
  let tools: ToolInfo[] | undefined;
  return {
    async tools() {
      tools ??= (await client.listTools()).tools.map((t) => ({
        name: t.name, description: t.description ?? "", inputSchema: t.inputSchema as Record<string, unknown>,
      }));
      return tools;
    },
    async call(name, args = {}) {
      const r = await client.callTool({ name, arguments: args });
      const text = (r.content as { type: string; text?: string }[]).find((x) => x.type === "text")?.text ?? "";
      const structured = r.structuredContent as Omit<ToolReply, "text"> | undefined;
      if (r.isError || !structured || !Array.isArray(structured.say)) throw new MiaToolError(name, text);
      return { ...structured, text };
    },
    async proactive() {
      const res = await fetchFn(`${c.url}/proactive`, { headers });
      if (!res.ok) throw new Error(`proactive: HTTP ${res.status}`);
      return ((await res.json()) as { prompt: ProactivePrompt | null }).prompt;
    },
  };
}
