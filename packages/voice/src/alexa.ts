import { createVerify, X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import { phraseText } from "@mia/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Brain, Reply, VoiceProfile } from "./brain";
import { MAX_TURN_CHARS } from "./server";

/**
 * A classic Alexa custom skill in front of the Brain, for an Echo while Alexa+ add-ons are closed to us.
 * Her words arrive in one catch-all slot and go to brain.turn as if typed; Mia's sentences go back as SSML.
 * Served on its own port so a tunnel exposes only this route, never the local page or /api.
 */

/** Alexa requests older or newer than this are refused (Alexa's own limit). */
export const MAX_SKEW_MS = 150_000;
export const ALEXA_BODY_BYTES = 128 * 1024;

const LISTENING = { "en-US": "I'm listening.", "de-DE": "Ich höre dir zu." } as const;
const NOT_HEARD = { "en-US": "I didn't catch that. Please say it again.", "de-DE": "Das habe ich nicht verstanden. Sag es bitte noch einmal." } as const;
/** Alexa's built-in help intent: her word goes to the brain, so a cry for help is heard as one. */
const HELP_WORD = { "en-US": "help", "de-DE": "Hilfe" } as const;

export interface AlexaRequestCheck { headers: Headers; body: string }
export type AlexaVerifier = (req: AlexaRequestCheck) => Promise<boolean>;

export interface AlexaAppDeps {
  brain: Pick<Brain, "turn" | "proactive">;
  profile: VoiceProfile;
  skillId: string;
  verify: AlexaVerifier;
  now?: () => Date;
}

interface AlexaBody {
  request?: { type?: string; timestamp?: string; intent?: { name?: string; slots?: Record<string, { value?: string }> } };
  session?: { application?: { applicationId?: string } };
  context?: { System?: { application?: { applicationId?: string } } };
}

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

/** Alexa already pauses about this long after a full stop; her sentence break is the whole pause, not extra. */
export const ALEXA_SENTENCE_PAUSE_MS = 400;

/** Mia's sentences, her sentence break between each (Alexa's own pause counted in), at her speech rate. */
export function toSsml(sentences: string[], rate: number, breakMs: number): string {
  const extra = Math.max(0, Math.round(breakMs - ALEXA_SENTENCE_PAUSE_MS));
  const inner = sentences.map(escapeXml).join(extra ? `<break time="${extra}ms"/>` : " ");
  return `<speak><prosody rate="${Math.round(rate * 100)}%">${inner}</prosody></speak>`;
}

export function createAlexaApp(deps: AlexaAppDeps): Hono {
  const app = new Hono();
  const { locale, speech, preferredName, carerName } = deps.profile;
  const now = deps.now ?? (() => new Date());
  const rate = speech.speechRate / 100;
  const vars = { name: preferredName, carer: carerName };

  const speak = (sentences: string[], end: boolean) => ({
    version: "1.0",
    response: {
      outputSpeech: { type: "SSML", ssml: toSsml(sentences, rate, speech.sentenceBreakMs) },
      ...(end ? {} : { reprompt: { outputSpeech: { type: "SSML", ssml: toSsml([LISTENING[locale]], rate, speech.sentenceBreakMs) } } }),
      shouldEndSession: end,
    },
  });
  const say = (reply: Reply) => speak(reply.sentences, false);

  app.use("*", async (c, next) => {
    await next();
    c.res.headers.set("x-content-type-options", "nosniff");
  });
  app.use("/alexa", bodyLimit({ maxSize: ALEXA_BODY_BYTES, onError: (c) => c.json({ error: "too large" }, 413) }));

  app.post("/alexa", async (c) => {
    const raw = await c.req.text();
    const refuse = (why: string) => { console.warn(`[mia-alexa] refused: ${why}`); return c.json({ error: "forbidden" }, 403); };
    if (!(await deps.verify({ headers: c.req.raw.headers, body: raw }))) return refuse("signature");
    let body: AlexaBody;
    try { body = JSON.parse(raw) as AlexaBody; } catch { return c.json({ error: "bad request" }, 400); }
    const appId = body.context?.System?.application?.applicationId ?? body.session?.application?.applicationId;
    if (appId !== deps.skillId) return refuse(`skill id ${appId}`);
    const at = Date.parse(body.request?.timestamp ?? "");
    if (!Number.isFinite(at) || Math.abs(now().getTime() - at) > MAX_SKEW_MS) return refuse(`timestamp ${body.request?.timestamp}`);

    const type = body.request?.type;
    console.log(`[mia-alexa] ${type} ${body.request?.intent?.name ?? ""}`);
    if (type === "SessionEndedRequest") return c.json({ version: "1.0", response: {} });
    if (type === "LaunchRequest") {
      // What Mia would have said first (pills, the group, bedtime), else a plain hello.
      const first = await deps.brain.proactive();
      return c.json(first ? say(first) : speak([phraseText("hello", locale, vars)!, LISTENING[locale]], false));
    }
    if (type !== "IntentRequest") return c.json({ version: "1.0", response: {} });

    const intent = body.request?.intent;
    switch (intent?.name) {
      case "AMAZON.StopIntent":
      case "AMAZON.CancelIntent":
        return c.json(speak([phraseText("lovely_day", locale, vars)!], true));
      case "AMAZON.HelpIntent":
        return c.json(say(await deps.brain.turn({ text: HELP_WORD[locale] })));
      case "MiaIntent": {
        const text = (intent.slots?.text?.value ?? "").trim();
        if (text) return c.json(say(await deps.brain.turn({ text: Array.from(text).slice(-MAX_TURN_CHARS).join("") })));
        return c.json(speak([NOT_HEARD[locale]], false));
      }
      default:
        return c.json(speak([NOT_HEARD[locale]], false));
    }
  });
  return app;
}

const CERT_HOST = "s3.amazonaws.com";
const CERT_PATH = "/echo.api/";
const CERT_SAN = "echo-api.amazon.com";

/** Alexa's rules for SignatureCertChainUrl: https, s3.amazonaws.com, port 443, path under /echo.api/. */
export function isValidCertUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:" || u.hostname.toLowerCase() !== CERT_HOST || (u.port !== "" && u.port !== "443")) return false;
  // URL normalises "/echo.api/../x"; the raw path must also not climb out.
  return u.pathname.startsWith(CERT_PATH) && !raw.includes("/../");
}

function parseChain(pem: string): X509Certificate[] {
  return (pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []).map((b) => new X509Certificate(b));
}

const ROOTS = rootCertificates.map((pem) => new X509Certificate(pem));

/** The chain is in date, names echo-api.amazon.com, and leads to a root the system trusts. */
export function isTrustedChain(chain: X509Certificate[], at: Date, roots: X509Certificate[] = ROOTS): boolean {
  const leaf = chain[0];
  if (!leaf) return false;
  const inDate = (c: X509Certificate) => new Date(c.validFrom) <= at && at <= new Date(c.validTo);
  if (!chain.every(inDate)) return false;
  if (!(leaf.subjectAltName ?? "").split(",").map((s) => s.trim()).includes(`DNS:${CERT_SAN}`)) return false;
  for (let i = 0; i + 1 < chain.length; i++) {
    if (!chain[i]!.checkIssued(chain[i + 1]!) || !chain[i]!.verify(chain[i + 1]!.publicKey)) return false;
  }
  const top = chain[chain.length - 1]!;
  return roots.some((r) => inDate(r) && (r.fingerprint256 === top.fingerprint256 || (top.checkIssued(r) && top.verify(r.publicKey))));
}

/** Checks Alexa's Signature-256 header over the raw body with the certificate chain it names (cached per URL). */
export function alexaSignatureVerifier(o: { fetchPem?: (url: string) => Promise<string>; now?: () => Date; roots?: X509Certificate[] } = {}): AlexaVerifier {
  const fetchPem = o.fetchPem ?? (async (url) => {
    const r = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`cert chain ${r.status}`);
    return r.text();
  });
  const now = o.now ?? (() => new Date());
  const cache = new Map<string, X509Certificate[]>();
  return async ({ headers, body }) => {
    const url = headers.get("signaturecertchainurl") ?? "";
    const signature = headers.get("signature-256") ?? "";
    if (!signature || !isValidCertUrl(url)) return false;
    try {
      let chain = cache.get(url);
      if (!chain) {
        chain = parseChain(await fetchPem(url));
        if (cache.size > 16) cache.clear();
        cache.set(url, chain);
      }
      if (!isTrustedChain(chain, now(), o.roots)) return false;
      return createVerify("RSA-SHA256").update(body).verify(chain[0]!.publicKey, signature, "base64");
    } catch (err) {
      console.error("[mia-alexa] signature check failed:", err instanceof Error ? err.message : err);
      return false;
    }
  };
}
