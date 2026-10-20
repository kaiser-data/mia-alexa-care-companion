import { join, resolve } from "node:path";
import { offsetClock } from "@mia/shared";
import { serve } from "@hono/node-server";
import { checkDevToken, loadProfile, startLocalMia } from "@mia/mcp-server/local";
import { OpenMeteoWeather } from "@mia/mcp-server/weather";
import { alexaSignatureVerifier, createAlexaApp } from "./alexa";
import { Brain } from "./brain";
import { connectMia } from "./mcp";
import { chooseLlm } from "./provider";
import { createVoiceApp, parseVoicePort } from "./server";

const root = resolve(import.meta.dirname, "../../..");
try { process.loadEnvFile(join(root, ".env")); } catch { /* no .env: rely on the environment */ }

const token = checkDevToken(process.env.MIA_DEV_TOKEN);
const { llm, provider, model } = chooseLlm(process.env);
console.log(`[mia-voice] LLM: ${provider} / ${model}`);
// A relative MIA_PROFILE_FILE is read from the repo root, like MIA_DATA_DIR.
const profileFile = process.env.MIA_PROFILE_FILE;
const profile = loadProfile({ ...process.env, MIA_PROFILE_FILE: profileFile && resolve(root, profileFile) });

// Demo recordings: MIA_CLOCK_START starts Mia's clock at a chosen time. Alexa's timestamp check keeps the real clock.
const now = offsetClock(process.env.MIA_CLOCK_START);
if (process.env.MIA_CLOCK_START) console.log(`[mia-voice] clock starts at ${now().toISOString()} (MIA_CLOCK_START)`);

const voicePort = parseVoicePort(process.env.VOICE_PORT);

// Embedded Mia only talks to this gateway: any free port will do.
const miaUrl = process.env.MIA_MCP_URL ?? (await startLocalMia({
  token, profile, port: 0,
  dataDir: resolve(root, process.env.MIA_DATA_DIR ?? ".mia-data"), weather: new OpenMeteoWeather(), now,
})).url;

const mia = await connectMia({ url: miaUrl, token });
const brain = new Brain({ mia, llm, profile, now });
const app = createVoiceApp({ brain, profile, publicDir: resolve(import.meta.dirname, "../public"), port: voicePort, publicOrigin: process.env.MIA_PUBLIC_ORIGIN || undefined });
serve({ fetch: app.fetch, port: voicePort, hostname: "127.0.0.1" });
console.log(`[mia-voice] LOCAL MODE — not production. Open http://127.0.0.1:${voicePort} in Chrome or Edge (profile: ${profile.id}, Mia: ${miaUrl}).`);

// Echo Dot: a classic Alexa skill on its own port, for a tunnel. Off unless MIA_ALEXA_SKILL_ID is set.
const skillId = process.env.MIA_ALEXA_SKILL_ID;
if (skillId) {
  const alexaPort = Number(process.env.ALEXA_PORT ?? 8789);
  const alexa = createAlexaApp({ brain, profile, skillId, verify: alexaSignatureVerifier() });
  serve({ fetch: alexa.fetch, port: alexaPort, hostname: "127.0.0.1" });
  console.log(`[mia-alexa] skill endpoint on http://127.0.0.1:${alexaPort}/alexa (only Alexa-signed requests for this skill)`);
}
