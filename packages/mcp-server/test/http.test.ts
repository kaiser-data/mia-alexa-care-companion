import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { beforeEach, describe, expect, it } from "vitest";
import { rose } from "@mia/shared";
import { at } from "@mia/shared/testing";
import { StoreAlertSink } from "../src/alerts";
import { createHttpApp } from "../src/http";
import { LocalAesCipher } from "../src/store/crypto";
import { SqliteStore } from "../src/store/sqliteStore";

const TOKEN = "test-token-123";
let app: ReturnType<typeof createHttpApp>;

beforeEach(async () => {
  const store = new SqliteStore(":memory:", new LocalAesCipher(randomBytes(32)));
  await store.putProfile(rose());
  app = createHttpApp({
    tokens: new Map([[TOKEN, "rose"]]),
    makeContext: (profileId) => ({ store, profileId, now: () => at("2026-10-12T08:05:00"), alerts: new StoreAlertSink(store) }),
  });
});

const initialize = (protocolVersion: string, auth = `Bearer ${TOKEN}`) =>
  app.request("/mcp", {
    method: "POST",
    headers: { authorization: auth, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion, capabilities: {}, clientInfo: { name: "Alexa+ MCP Client", version: "1.0.0" } } }),
  });

describe("HTTP /mcp", () => {
  it("health check", async () => {
    expect(await (await app.request("/health")).json()).toEqual({ ok: true });
  });
  it("rejects requests without a valid bearer token", async () => {
    const r = await initialize("2025-03-26", "Bearer wrong");
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain("Bearer");
  });
  it.each(["2025-03-26", "2025-11-25"])("negotiates protocol %s (Alexa+ uses 2025-03-26)", async (version) => {
    const r = await initialize(version);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { result: { protocolVersion: string; serverInfo: { name: string } } };
    expect(body.result.protocolVersion).toBe(version);
    expect(body.result.serverInfo.name).toBe("mia");
  });
  it("serves all 16 tools to a real MCP client over Streamable HTTP", async () => {
    const transport = new StreamableHTTPClientTransport(new URL("http://mia.test/mcp"), {
      fetch: async (url, init) => app.request(url.toString(), init),
      requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
    });
    const client = new Client({ name: "http-test", version: "0.0.0" });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "ask_carer_about_health", "chat_about_life", "comfort_me", "confirm_medication", "get_medication_status", "get_next_appointment",
      "get_preparation_steps", "get_today", "night_reassurance", "play_music", "repeat_last", "report_home", "report_leaving",
      "report_problem", "request_call", "who_is",
    ]);
    for (const t of tools) expect(t.description!.length).toBeGreaterThan(60);
    const r = await client.callTool({ name: "get_today", arguments: {} });
    expect((r.content as { text: string }[])[0]!.text).toContain("Today is Monday, October 12.");
    await client.close();
  });
});
