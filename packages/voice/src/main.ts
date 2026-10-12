import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { checkDevToken, startLocalMia } from "@mia/mcp-server/local";
import { OpenMeteoWeather } from "@mia/mcp-server/weather";
import { isSeedId, SEED_PROFILES } from "@mia/shared";
import { Brain } from "./brain";
import { connectMia } from "./mcp";
import { chooseLlm } from "./provider";
import { createVoiceApp, parseVoicePort } from "./server";

const root = resolve(import.meta.dirname, "../../..");
try { process.loadEnvFile(join(root, ".env")); } catch { /* no .env: rely on the environment */ }

const token = checkDevToken(process.env.MIA_DEV_TOKEN);
const { llm, provider, model } = chooseLlm(process.env);
console.log(`[mia-voice] LLM: ${provider} / ${model}`);
const profileId = process.env.MIA_PROFILE ?? "rose";
if (!isSeedId(profileId)) throw new Error(`MIA_PROFILE must be one of: ${Object.keys(SEED_PROFILES).join(", ")}`);
const profile = SEED_PROFILES[profileId]();

const voicePort = parseVoicePort(process.env.VOICE_PORT);

// Embedded Mia only talks to this gateway: any free port will do.
const miaUrl = process.env.MIA_MCP_URL ?? (await startLocalMia({
  token, profileId, port: 0,
  dataDir: resolve(root, process.env.MIA_DATA_DIR ?? ".mia-data"), weather: new OpenMeteoWeather(),
})).url;

const mia = await connectMia({ url: miaUrl, token });
const brain = new Brain({ mia, llm, profile, now: () => new Date() });
const app = createVoiceApp({ brain, profile, publicDir: resolve(import.meta.dirname, "../public"), port: voicePort });
serve({ fetch: app.fetch, port: voicePort, hostname: "127.0.0.1" });
console.log(`[mia-voice] LOCAL MODE — not production. Open http://127.0.0.1:${voicePort} in Chrome or Edge (profile: ${profileId}, Mia: ${miaUrl}).`);
