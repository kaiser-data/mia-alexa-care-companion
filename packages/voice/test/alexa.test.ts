import { execFileSync } from "node:child_process";
import { createSign, X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rose, roseDe } from "@mia/shared";
import { alexaSignatureVerifier, createAlexaApp, isTrustedChain, isValidCertUrl, toSsml } from "../src/alexa";
import type { Reply } from "../src/brain";

const SKILL = "amzn1.ask.skill.test";
const NOW = new Date("2026-10-20T10:00:00Z");
const reply: Reply = { sentences: ["Hello, Rose.", "It's Tuesday."], rate: 0.9, breakMs: 700, tools: [] };

function app(o: { proactive?: Reply | null; verified?: boolean; profile?: ReturnType<typeof rose> } = {}) {
  const turns: unknown[] = [];
  const brain = { turn: async (t: unknown) => { turns.push(t); return reply; }, proactive: async () => o.proactive ?? null };
  const a = createAlexaApp({ brain, profile: o.profile ?? rose(), skillId: SKILL, verify: async () => o.verified ?? true, now: () => NOW });
  return { a, turns };
}

const envelope = (request: Record<string, unknown>, skill = SKILL) => ({
  version: "1.0",
  context: { System: { application: { applicationId: skill } } },
  request: { timestamp: NOW.toISOString(), ...request },
});
const post = (a: ReturnType<typeof app>["a"], body: unknown) =>
  a.request("/alexa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ssml = async (r: Response) => ((await r.json()) as { response: { outputSpeech: { ssml: string } } }).response.outputSpeech.ssml;
const intent = (name: string, text?: string) => envelope({ type: "IntentRequest", intent: { name, slots: text === undefined ? {} : { text: { value: text } } } });

describe("Alexa skill endpoint", () => {
  it("her words go to the brain; Mia's sentences come back as SSML, the session stays open", async () => {
    const { a, turns } = app();
    const r = await post(a, intent("MiaIntent", "what day is it"));
    expect(turns).toEqual([{ text: "what day is it" }]);
    const body = await r.json() as { response: { shouldEndSession: boolean; reprompt?: unknown; outputSpeech: { ssml: string } } };
    expect(body.response.outputSpeech.ssml).toBe('<speak><prosody rate="90%">Hello, Rose.<break time="300ms"/>It\'s Tuesday.</prosody></speak>'.replace("'", "&apos;"));
    expect(body.response.shouldEndSession).toBe(false);
    expect(body.response.reprompt).toBeDefined();
  });
  it("launch speaks what Mia would have said first, else a hello", async () => {
    expect(await ssml(await post(app({ proactive: reply }).a, envelope({ type: "LaunchRequest" })))).toContain("It&apos;s Tuesday.");
    expect(await ssml(await post(app({ profile: roseDe() }).a, envelope({ type: "LaunchRequest" })))).toContain("Hallo, Rose.");
  });
  it("the help intent is her word 'Hilfe' to the brain, so a cry for help raises the alert", async () => {
    const { a, turns } = app({ profile: roseDe() });
    await post(a, intent("AMAZON.HelpIntent"));
    expect(turns).toEqual([{ text: "Hilfe" }]);
  });
  it("stop ends the session with a goodbye; nothing heard asks again without the brain", async () => {
    const { a, turns } = app();
    const stop = await (await post(a, intent("AMAZON.StopIntent"))).json() as { response: { shouldEndSession: boolean } };
    expect(stop.response.shouldEndSession).toBe(true);
    expect(await ssml(await post(a, intent("MiaIntent", "  ")))).toContain("say it again");
    expect(await ssml(await post(a, intent("AMAZON.FallbackIntent")))).toContain("say it again");
    expect(turns).toEqual([]);
  });
  it("refuses an unsigned request, another skill, or an old or future timestamp", async () => {
    expect((await post(app({ verified: false }).a, intent("MiaIntent", "hi"))).status).toBe(403);
    expect((await post(app().a, { ...intent("MiaIntent", "hi"), context: { System: { application: { applicationId: "other" } } } })).status).toBe(403);
    for (const ms of [-151_000, 151_000]) {
      const old = intent("MiaIntent", "hi");
      old.request.timestamp = new Date(NOW.getTime() + ms).toISOString();
      expect((await post(app().a, old)).status, String(ms)).toBe(403);
    }
  });
  it("a long utterance keeps its last words", async () => {
    const { a, turns } = app();
    await post(a, intent("MiaIntent", `${"x".repeat(600)} help`));
    expect((turns[0] as { text: string }).text.endsWith(" help")).toBe(true);
    expect((turns[0] as { text: string }).text.length).toBe(500);
  });
  it("Alexa's own pause after a full stop counts toward her sentence break", () => {
    expect(toSsml(["A.", "B."], 0.95, 300)).toBe('<speak><prosody rate="95%">A. B.</prosody></speak>');
  });
  it("SSML escapes her profile's words", () => {
    expect(toSsml(["Tom & June <3"], 1, 500)).toBe('<speak><prosody rate="100%">Tom &amp; June &lt;3</prosody></speak>');
  });
});

describe("Alexa signature check", () => {
  it.each([
    ["https://s3.amazonaws.com/echo.api/echo-api-cert.pem", true],
    ["https://S3.AMAZONAWS.COM/echo.api/echo-api-cert.pem", true],
    ["https://s3.amazonaws.com:443/echo.api/echo-api-cert.pem", true],
    ["http://s3.amazonaws.com/echo.api/echo-api-cert.pem", false],
    ["https://notamazon.com/echo.api/echo-api-cert.pem", false],
    ["https://s3.amazonaws.com/EcHo.aPi/echo-api-cert.pem", false],
    ["https://s3.amazonaws.com/echo.api/../echo-api-cert.pem", false],
    ["https://s3.amazonaws.com:563/echo.api/echo-api-cert.pem", false],
  ])("cert URL %s → %s", (url, ok) => expect(isValidCertUrl(url)).toBe(ok));

  // A throwaway CA and an echo-api.amazon.com leaf, made with openssl for this run.
  const dir = mkdtempSync(join(tmpdir(), "mia-alexa-"));
  const ssl = (...args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
  ssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "2", "-subj", "/CN=Test Root");
  ssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", "leaf.key", "-out", "leaf.csr", "-subj", "/CN=echo-api.amazon.com");
  writeFileSync(join(dir, "ext.cnf"), "subjectAltName=DNS:echo-api.amazon.com\n");
  ssl("x509", "-req", "-in", "leaf.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "leaf.pem", "-days", "1", "-extfile", "ext.cnf");
  const ca = readFileSync(join(dir, "ca.pem"), "utf8");
  const leafPem = readFileSync(join(dir, "leaf.pem"), "utf8");
  const leafKey = readFileSync(join(dir, "leaf.key"), "utf8");
  const roots = [new X509Certificate(ca)];
  const URL_OK = "https://s3.amazonaws.com/echo.api/echo-api-cert.pem";
  const sign = (body: string) => createSign("RSA-SHA256").update(body).sign(leafKey, "base64");
  const headers = (sig: string, url = URL_OK) => new Headers({ signaturecertchainurl: url, "signature-256": sig });

  it("accepts a body signed by a trusted echo-api leaf; refuses a changed body or an untrusted root", async () => {
    let fetched = 0;
    const verify = alexaSignatureVerifier({ fetchPem: async () => { fetched++; return leafPem + ca; }, roots });
    const body = JSON.stringify(intent("MiaIntent", "hi"));
    expect(await verify({ headers: headers(sign(body)), body })).toBe(true);
    expect(await verify({ headers: headers(sign(body)), body: body.replace("hi", "ho") })).toBe(false);
    expect(await verify({ headers: headers(""), body })).toBe(false);
    expect(fetched).toBe(1);
    const untrusted = alexaSignatureVerifier({ fetchPem: async () => leafPem + ca, roots: [] });
    expect(await untrusted({ headers: headers(sign(body)), body })).toBe(false);
  });
  it("refuses an expired chain or a leaf without the echo-api name", () => {
    const chain = [new X509Certificate(leafPem), new X509Certificate(ca)];
    expect(isTrustedChain(chain, new Date(), roots)).toBe(true);
    expect(isTrustedChain(chain, new Date(Date.now() + 5 * 86_400_000), roots)).toBe(false);
    expect(isTrustedChain([new X509Certificate(ca)], new Date(), roots)).toBe(false);
  });
});
