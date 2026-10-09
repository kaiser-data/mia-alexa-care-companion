import { timingSafeEqual } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { createMiaServer } from "./server";
import type { ToolContext } from "./tools/runtime";

export interface HttpDeps {
  /** bearer token → profile id. Local mode only; OAuth 2.1 replaces this in Plan 4. */
  tokens: Map<string, string>;
  makeContext(profileId: string): ToolContext;
}

function profileFor(tokens: Map<string, string>, header: string | undefined): string | null {
  const given = Buffer.from(header?.startsWith("Bearer ") ? header.slice(7) : "");
  for (const [token, profileId] of tokens) {
    const expected = Buffer.from(token);
    if (given.length === expected.length && timingSafeEqual(given, expected)) return profileId;
  }
  return null;
}

export function createHttpApp(deps: HttpDeps): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.all("/mcp", async (c) => {
    const profileId = profileFor(deps.tokens, c.req.header("authorization"));
    if (!profileId) return c.json({ error: "unauthorized" }, 401, { "WWW-Authenticate": 'Bearer realm="mia"' });
    // Stateless: one server + transport per request (Alexa+ keeps no MCP session).
    const server = createMiaServer(deps.makeContext(profileId));
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return app;
}
