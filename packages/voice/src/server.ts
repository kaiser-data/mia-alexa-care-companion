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
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self'";

function parseTurn(body: unknown): TurnInput | null {
  if (typeof body !== "object" || body === null) return null;
  const { text, confidence } = body as Record<string, unknown>;
  if (typeof text !== "string" || text.length > MAX_TURN_CHARS) return null;
  if (confidence !== undefined && (typeof confidence !== "number" || confidence < 0 || confidence > 1)) return null;
  return confidence === undefined ? { text } : { text, confidence };
}

export interface VoiceAppDeps { brain: Pick<Brain, "turn" | "proactive">; profile: VoiceProfile; publicDir: string; port: number }

export function createVoiceApp(deps: VoiceAppDeps): Hono {
  const app = new Hono();
  const { speech, locale, carerName } = deps.profile;
  const hosts = [`127.0.0.1:${deps.port}`, `localhost:${deps.port}`];
  const origins = hosts.map((h) => `http://${h}`);

  // The gateway only answers its own page: no other site, no DNS rebinding, no form posts.
  app.use("/api/*", async (c, next) => {
    if (!hosts.includes(c.req.header("host") ?? "")) return c.json({ error: "forbidden" }, 403);
    const origin = c.req.header("origin");
    if (origin !== undefined && !origins.includes(origin)) return c.json({ error: "forbidden" }, 403);
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
