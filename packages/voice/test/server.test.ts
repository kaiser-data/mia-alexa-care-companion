import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rose } from "@mia/shared";
import type { Reply } from "../src/brain";
import { createVoiceApp } from "../src/server";

const reply: Reply = { sentences: ["Hello, Rose."], rate: 0.9, breakMs: 700, tools: [] };

const ORIGIN = "http://127.0.0.1:8788";
const LOCAL = { host: "127.0.0.1:8788", origin: ORIGIN };

function app(proactive: Reply | null = null, turn?: () => Promise<Reply>) {
  const publicDir = mkdtempSync(join(tmpdir(), "mia-public-"));
  writeFileSync(join(publicDir, "index.html"), "<!doctype html><p>LOCAL MODE — not production</p>");
  writeFileSync(join(publicDir, "app.js"), "export {};");
  writeFileSync(join(publicDir, "turn.js"), "export {};");
  writeFileSync(join(publicDir, "style.css"), "body{}");
  const turns: unknown[] = [];
  const brain = { turn: async (t: unknown) => { turns.push(t); return turn ? turn() : reply; }, proactive: async () => proactive };
  const a = createVoiceApp({ brain, profile: rose(), publicDir, port: 8788 });
  // Like the browser on its own page: right Host, and Origin on fetches.
  const request = (url: string, init: RequestInit = {}) =>
    a.request(url, { ...init, headers: { ...LOCAL, ...(init.headers as Record<string, string> | undefined) } });
  return { app: { request }, turns };
}

const post = (a: ReturnType<typeof app>["app"], body: unknown, headers: Record<string, string> = {}) =>
  a.request("/api/turn", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

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
  it("a POST that is not JSON is refused", async () => {
    expect((await post(app().app, { text: "hi" }, { "content-type": "text/plain" })).status).toBe(415);
  });
  it("a foreign page may not talk to the gateway", async () => {
    expect((await post(app().app, { text: "hi" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await app().app.request("/api/config", { headers: { origin: "http://127.0.0.1:9999" } })).status).toBe(403);
  });
  it("a request for another host name is refused (DNS rebinding)", async () => {
    expect((await post(app().app, { text: "hi" }, { host: "evil.example:8788" })).status).toBe(403);
    expect((await app().app.request("/api/config", { headers: { host: "evil.example:8788" } })).status).toBe(403);
    expect((await app().app.request("/api/config", { headers: { host: "localhost:8788", origin: "http://localhost:8788" } })).status).toBe(200);
  });
  it("a body over 4 KB is refused", async () => {
    expect((await post(app().app, JSON.stringify({ text: "x".repeat(5 * 1024) }))).status).toBe(413);
  });
  it("a brain that throws still gives her a calm reply", async () => {
    const r = await post(app(null, async () => { throw new Error("boom"); }).app, { text: "hi" });
    expect(r.status).toBe(200);
    const body = await r.json() as Reply;
    expect(body.sentences[0]).toBe("I can't check right now.");
    expect(body).toMatchObject({ rate: 0.9, breakMs: 700, tools: [] });
  });
  it("a missing page file is a 404, not a crash", async () => {
    const publicDir = mkdtempSync(join(tmpdir(), "mia-empty-"));
    const brain = { turn: async () => reply, proactive: async () => null };
    const a = createVoiceApp({ brain, profile: rose(), publicDir, port: 8788 });
    expect((await a.request("/style.css", { headers: LOCAL })).status).toBe(404);
  });
});
