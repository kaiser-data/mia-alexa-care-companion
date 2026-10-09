import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import type { Brain, TurnInput, VoiceProfile } from "./brain";

export const MAX_TURN_CHARS = 500;

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

export function createVoiceApp(deps: { brain: Pick<Brain, "turn" | "proactive">; profile: VoiceProfile; publicDir: string }): Hono {
  const app = new Hono();
  const { speech, locale } = deps.profile;

  app.get("/api/config", (c) => c.json({
    locale, endOfTurnTimeoutMs: speech.endOfTurnTimeoutMs, rate: speech.speechRate / 100, breakMs: speech.sentenceBreakMs, mode: "local",
  }));

  app.post("/api/turn", async (c) => {
    const turn = parseTurn(await c.req.json().catch(() => null));
    if (!turn) return c.json({ error: "bad request" }, 400);
    return c.json(await deps.brain.turn(turn));
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
    app.get(route, async (c) => c.body(await readFile(join(deps.publicDir, file), "utf8"), 200, {
      "content-type": type, "content-security-policy": CSP, "cache-control": "no-store",
    }));
  }

  return app;
}
