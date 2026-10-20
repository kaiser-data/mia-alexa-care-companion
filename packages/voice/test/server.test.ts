import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rose } from "@mia/shared";
import type { Reply } from "../src/brain";
import { createVoiceApp, DEFAULT_VOICE_PORT, parseVoicePort } from "../src/server";

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
  it.each([{}, { text: 5 }, { text: "hi", confidence: 2 }, { text: "hi", confidence: "high" }])(
    "rejects %j", async (body) => expect((await post(app().app, body)).status).toBe(400));
  it("a long turn is cut to its last words, not refused", async () => {
    const a = app();
    const r = await post(a.app, { text: "x".repeat(501) });
    expect(r.status).toBe(200);
    const b = app();
    expect((await post(b.app, { text: `${"a".repeat(600)} I fell` })).status).toBe(200);
    const got = (b.turns[0] as { text: string }).text;
    expect(got.endsWith("I fell")).toBe(true);
    expect(Array.from(got).length).toBeLessThanOrEqual(500);
  });
  it("another site may not reach the API, even without an Origin header", async () => {
    let calls = 0;
    const a = createVoiceApp({
      brain: { turn: async () => reply, proactive: async () => { calls += 1; return reply; } },
      profile: rose(), publicDir: tmpdir(), port: 8788,
    });
    const get = (site: string) => a.request("/api/proactive", { headers: { host: "127.0.0.1:8788", "sec-fetch-site": site } });
    expect((await get("cross-site")).status).toBe(403);
    expect((await get("same-site")).status).toBe(403);
    expect(calls).toBe(0);
    expect((await get("same-origin")).status).toBe(200);
    expect((await get("none")).status).toBe(200);
    expect(calls).toBe(2);
  });
  it("proactive", async () => {
    expect(await (await app(reply).app.request("/api/proactive")).json()).toEqual({ reply });
    expect(await (await app(null).app.request("/api/proactive")).json()).toEqual({ reply: null });
  });
  it("serves the page with a strict content security policy", async () => {
    const r = await app().app.request("/");
    expect(r.headers.get("content-type")).toContain("text/html");
    const csp = r.headers.get("content-security-policy")!;
    expect(csp).toContain("default-src 'self'");
    for (const d of ["frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'"]) expect(csp).toContain(d);
    expect(await r.text()).toContain("LOCAL MODE");
    expect((await app().app.request("/app.js")).headers.get("content-type")).toContain("text/javascript");
    expect((await app().app.request("/../package.json")).status).toBe(404);
  });
  it("every response says nosniff, errors included", async () => {
    const a = app().app;
    for (const r of [
      await a.request("/"), await a.request("/app.js"), await a.request("/api/config"), await a.request("/nope"),
      await post(a, { text: "hi" }, { origin: "https://evil.example" }),
    ]) expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("VOICE_PORT must be a whole number from 1 to 65535", () => {
    expect(parseVoicePort(undefined)).toBe(DEFAULT_VOICE_PORT);
    expect(parseVoicePort("9000")).toBe(9000);
    for (const bad of ["0", "65536", "abc", "80.5", "-1", "8788x"]) expect(() => parseVoicePort(bad)).toThrow(/VOICE_PORT/);
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

describe("public origin (behind Caddy on AWS)", () => {
  const PUBLIC = "https://3-120-1-2.sslip.io";
  function publicApp() {
    const publicDir = mkdtempSync(join(tmpdir(), "mia-public-"));
    writeFileSync(join(publicDir, "index.html"), "<!doctype html>");
    const brain = { turn: async () => reply, proactive: async () => null };
    return createVoiceApp({ brain, profile: rose(), publicDir, port: 8788, publicOrigin: PUBLIC });
  }
  const turn = (a: ReturnType<typeof publicApp>, headers: Record<string, string>) =>
    a.request("/api/turn", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ text: "hi" }) });
  it("answers its own page on the public host", async () => {
    expect((await turn(publicApp(), { host: "3-120-1-2.sslip.io", origin: PUBLIC })).status).toBe(200);
  });
  it("still refuses other hosts and origins", async () => {
    expect((await turn(publicApp(), { host: "evil.example", origin: PUBLIC })).status).toBe(403);
    expect((await turn(publicApp(), { host: "3-120-1-2.sslip.io", origin: "https://evil.example" })).status).toBe(403);
  });
  it("refuses a public origin that is not https", () => {
    expect(() => createVoiceApp({ brain: { turn: async () => reply, proactive: async () => null }, profile: rose(), publicDir: tmpdir(), port: 8788, publicOrigin: "http://x.example" })).toThrow(/https/);
  });
});
