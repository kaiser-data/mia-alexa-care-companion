import { join, resolve } from "node:path";
import { checkDevToken, loadProfile, startLocalMia } from "./local";
import { OpenMeteoWeather } from "./weather";

const root = resolve(import.meta.dirname, "../../..");
try { process.loadEnvFile(join(root, ".env")); } catch { /* no .env: rely on the environment */ }

const token = checkDevToken(process.env.MIA_DEV_TOKEN);
// A relative MIA_PROFILE_FILE is read from the repo root, like MIA_DATA_DIR.
const profileFile = process.env.MIA_PROFILE_FILE;
const profile = loadProfile({ ...process.env, MIA_PROFILE_FILE: profileFile && resolve(root, profileFile) });
const dataDir = resolve(root, process.env.MIA_DATA_DIR ?? ".mia-data");
const port = Number(process.env.PORT ?? 8787);

const mia = await startLocalMia({ token, profile, dataDir, port, weather: new OpenMeteoWeather() });
console.log(`[mia] LOCAL MODE — not production. MCP endpoint: ${mia.url}/mcp (profile: ${profile.id})`);
