import { join, resolve } from "node:path";
import { offsetClock } from "@mia/shared";
import { checkDevToken, loadProfile, startLocalMia } from "./local";
import { alertEmailOffWarning, maskEmail, sesMailerFromEnv } from "./ses";
import { OpenMeteoWeather } from "./weather";

const root = resolve(import.meta.dirname, "../../..");
try { process.loadEnvFile(join(root, ".env")); } catch { /* no .env: rely on the environment */ }

const token = checkDevToken(process.env.MIA_DEV_TOKEN);
// A relative MIA_PROFILE_FILE is read from the repo root, like MIA_DATA_DIR.
const profileFile = process.env.MIA_PROFILE_FILE;
const profile = loadProfile({ ...process.env, MIA_PROFILE_FILE: profileFile && resolve(root, profileFile) });
const dataDir = resolve(root, process.env.MIA_DATA_DIR ?? ".mia-data");
const port = Number(process.env.PORT ?? 8787);

const mailer = sesMailerFromEnv(process.env);
const mia = await startLocalMia({ token, profile, dataDir, port, weather: new OpenMeteoWeather(), now: offsetClock(process.env.MIA_CLOCK_START), mailer });
console.log(`[mia] LOCAL MODE — not production. MCP endpoint: ${mia.url}/mcp (profile: ${profile.id})`);
if (mailer) console.log(`[mia] alert email on → ${maskEmail(process.env.MIA_ALERT_EMAIL_TO)}`);
const mailOff = alertEmailOffWarning(process.env, mailer !== null);
if (mailOff) console.warn(mailOff);
