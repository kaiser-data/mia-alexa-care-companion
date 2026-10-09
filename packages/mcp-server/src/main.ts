import { join, resolve } from "node:path";
import { isSeedId, SEED_PROFILES } from "@mia/shared";
import { checkDevToken, startLocalMia } from "./local";
import { OpenMeteoWeather } from "./weather";

const root = resolve(import.meta.dirname, "../../..");
try { process.loadEnvFile(join(root, ".env")); } catch { /* no .env: rely on the environment */ }

const token = checkDevToken(process.env.MIA_DEV_TOKEN);
const profileId = process.env.MIA_PROFILE ?? "rose";
if (!isSeedId(profileId)) throw new Error(`MIA_PROFILE must be one of: ${Object.keys(SEED_PROFILES).join(", ")}`);
const dataDir = resolve(root, process.env.MIA_DATA_DIR ?? ".mia-data");
const port = Number(process.env.PORT ?? 8787);

const mia = await startLocalMia({ token, profileId, dataDir, port, weather: new OpenMeteoWeather() });
console.log(`[mia] LOCAL MODE — not production. MCP endpoint: ${mia.url}/mcp (profile: ${profileId})`);
