import { join, resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { serve } from "@hono/node-server";
import { checkDevToken, startLocalMia } from "@mia/mcp-server/local";
import { OpenMeteoWeather } from "@mia/mcp-server/weather";
import { isSeedId, SEED_PROFILES } from "@mia/shared";
import { AnthropicLlm, DEFAULT_MODEL } from "./anthropic";
import { Brain } from "./brain";
import { connectMia } from "./mcp";
import { createVoiceApp } from "./server";

const root = resolve(import.meta.dirname, "../../..");
try { process.loadEnvFile(join(root, ".env")); } catch { /* no .env: rely on the environment */ }

const token = checkDevToken(process.env.MIA_DEV_TOKEN);
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("Set ANTHROPIC_API_KEY in the environment or .env (store it with your keys CLI; never commit it)");
const profileId = process.env.MIA_PROFILE ?? "rose";
if (!isSeedId(profileId)) throw new Error(`MIA_PROFILE must be one of: ${Object.keys(SEED_PROFILES).join(", ")}`);
const profile = SEED_PROFILES[profileId]();

const miaUrl = process.env.MIA_MCP_URL ?? (await startLocalMia({
  token, profileId, port: Number(process.env.PORT ?? 8787),
  dataDir: resolve(root, process.env.MIA_DATA_DIR ?? ".mia-data"), weather: new OpenMeteoWeather(),
})).url;

const mia = await connectMia({ url: miaUrl, token });
const llm = new AnthropicLlm(new Anthropic({ apiKey, timeout: 8000, maxRetries: 0 }), process.env.MIA_MODEL ?? DEFAULT_MODEL);
const brain = new Brain({ mia, llm, profile, now: () => new Date() });
const voicePort = Number(process.env.VOICE_PORT ?? 8788);
const app = createVoiceApp({ brain, profile, publicDir: resolve(import.meta.dirname, "../public"), port: voicePort });
serve({ fetch: app.fetch, port: voicePort, hostname: "127.0.0.1" });
console.log(`[mia-voice] LOCAL MODE — not production. Open http://127.0.0.1:${voicePort} in Chrome or Edge (profile: ${profileId}, Mia: ${miaUrl}).`);
