import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rose } from "@mia/shared";
import type { Reply } from "../src/brain";
import { createVoiceApp } from "../src/server";

const reply: Reply = { sentences: ["Hello, Rose."], rate: 0.9, breakMs: 700, tools: [] };

function app(proactive: Reply | null = null) {
  const publicDir = mkdtempSync(join(tmpdir(), "mia-public-"));
  writeFileSync(join(publicDir, "index.html"), "<!doctype html><p>LOCAL MODE — not production</p>");
  writeFileSync(join(publicDir, "app.js"), "export {};");
  writeFileSync(join(publicDir, "turn.js"), "export {};");
  writeFileSync(join(publicDir, "style.css"), "body{}");
  const turns: unknown[] = [];
  const brain = { turn: async (t: unknown) => { turns.push(t); return reply; }, proactive: async () => proactive };
  return { app: createVoiceApp({ brain, profile: rose(), publicDir }), turns };
}

const post = (a: ReturnType<typeof app>["app"], body: unknown) =>
  a.request("/api/turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("voice gateway", () => {
  it("config comes from the speech settings", async () => {
    expect(await (await app().app.request("/api/config")).json()).toEqual({
      locale: "en-US", endOfTurnTimeoutMs: 1800, rate: 0.9, breakMs: 700, mode: "local",
    });
  });
  it("a turn goes to the brain", async () => {
    const a = app();
    const r = await post(a.app, { text: "What day is it?", confidence: 0.9 });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(reply);
    expect(a.turns).toEqual([{ text: "What day is it?", confidence: 0.9 }]);
  });
  it.each([{}, { text: 5 }, { text: "x".repeat(501) }, { text: "hi", confidence: 2 }, { text: "hi", confidence: "high" }])(
    "rejects %j", async (body) => expect((await post(app().app, body)).status).toBe(400));
  it("proactive", async () => {
    expect(await (await app(reply).app.request("/api/proactive")).json()).toEqual({ reply });
    expect(await (await app(null).app.request("/api/proactive")).json()).toEqual({ reply: null });
  });
  it("serves the page with a strict content security policy", async () => {
    const r = await app().app.request("/");
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await r.text()).toContain("LOCAL MODE");
    expect((await app().app.request("/app.js")).headers.get("content-type")).toContain("text/javascript");
    expect((await app().app.request("/../package.json")).status).toBe(404);
  });
});
