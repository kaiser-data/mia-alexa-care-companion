import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { splitSentences, templates } from "@mia/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Brain, Reply, TurnInput, VoiceProfile } from "./brain";

export const MAX_TURN_CHARS = 500;
export const MAX_TURN_BODY_BYTES = 4 * 1024;

const FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/turn.js": { file: "turn.js", type: "text/javascript; charset=utf-8" },
  "/style.css": { file: "style.css", type: "text/css; charset=utf-8" },
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self'; "
  + "frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
export const DEFAULT_VOICE_PORT = 8788;

/** VOICE_PORT from the environment: an integer 1–65535, or the default when unset. */
export function parseVoicePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_VOICE_PORT;
  const port = Number(raw);
  if (!/^\d+$/.test(raw.trim()) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`VOICE_PORT must be a whole number from 1 to 65535, got "${raw}"`);
  }
  return port;
}

function parseTurn(body: unknown): TurnInput | null {
  if (typeof body !== "object" || body === null) return null;
  const { text, confidence } = body as Record<string, unknown>;
  if (typeof text !== "string") return null;
  if (confidence !== undefined && (typeof confidence !== "number" || confidence < 0 || confidence > 1)) return null;
  // A long turn is cut, not refused: the last words are what she said most recently, where a cry for help would be.
  const chars = Array.from(text);
  const kept = chars.length > MAX_TURN_CHARS ? chars.slice(-MAX_TURN_CHARS).join("") : text;
  return confidence === undefined ? { text: kept } : { text: kept, confidence };
}

export interface VoiceAppDeps { brain: Pick<Brain, "turn" | "proactive">; profile: VoiceProfile; publicDir: string; port: number; publicOrigin?: string }

export function createVoiceApp(deps: VoiceAppDeps): Hono {
  const app = new Hono();
  const { speech, locale, carerName } = deps.profile;
  const hosts = [`127.0.0.1:${deps.port}`, `localhost:${deps.port}`];
  const origins = hosts.map((h) => `http://${h}`);
  if (deps.publicOrigin) {
    const u = new URL(deps.publicOrigin);
    if (u.protocol !== "https:") throw new Error("MIA_PUBLIC_ORIGIN must be https");
    hosts.push(u.host);
    origins.push(u.origin);
  }

  // Every response, errors included: the browser must never guess a content type.
  app.use("*", async (c, next) => {
    await next();
    c.res.headers.set("x-content-type-options", "nosniff");
  });

  // The gateway only answers its own page: no other site, no DNS rebinding, no form posts.
  app.use("/api/*", async (c, next) => {
    if (!hosts.includes(c.req.header("host") ?? "")) return c.json({ error: "forbidden" }, 403);
    const origin = c.req.header("origin");
    if (origin !== undefined && !origins.includes(origin)) return c.json({ error: "forbidden" }, 403);
    // Browsers send Sec-Fetch-Site even on GETs without Origin: only the own page (or typing the URL) may pass.
    const site = c.req.header("sec-fetch-site");
    if (site !== undefined && site !== "same-origin" && site !== "none") return c.json({ error: "forbidden" }, 403);
    if (c.req.method === "POST" && !(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return c.json({ error: "unsupported media type" }, 415);
    }
    await next();
  });
  app.use("/api/turn", bodyLimit({ maxSize: MAX_TURN_BODY_BYTES, onError: (c) => c.json({ error: "too large" }, 413) }));

  app.get("/api/config", (c) => c.json({
    locale, endOfTurnTimeoutMs: speech.endOfTurnTimeoutMs, rate: speech.speechRate / 100, breakMs: speech.sentenceBreakMs, mode: "local",
  }));

  app.post("/api/turn", async (c) => {
    const turn = parseTurn(await c.req.json().catch(() => null));
    if (!turn) return c.json({ error: "bad request" }, 400);
    try {
      return c.json(await deps.brain.turn(turn));
    } catch (err) {
      console.error("[mia-voice] turn failed:", err);
      const fallback: Reply = {
        sentences: splitSentences(templates(locale).systemError(carerName), locale),
        rate: speech.speechRate / 100, breakMs: speech.sentenceBreakMs, tools: [],
      };
      return c.json(fallback);
    }
  });

  app.get("/api/proactive", async (c) => {
    try {
      return c.json({ reply: await deps.brain.proactive() });
    } catch (err) {
      console.error("[mia-voice] proactive failed:", err);
      return c.json({ reply: null });
    }
  });

  for (const [route, { file, type }] of Object.entries(FILES)) {
    app.get(route, async (c) => {
      let body: string;
      try {
        body = await readFile(join(deps.publicDir, file), "utf8");
      } catch (err) {
        console.error(`[mia-voice] cannot read ${file}:`, err);
        return c.notFound();
      }
      return c.body(body, 200, { "content-type": type, "content-security-policy": CSP, "cache-control": "no-store" });
    });
  }

  return app;
}
