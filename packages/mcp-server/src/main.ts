import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { rose, roseDe } from "@mia/shared";
import { StoreAlertSink } from "./alerts";
import { createHttpApp } from "./http";
import { LocalAesCipher, loadOrCreateLocalKey } from "./store/crypto";
import { SqliteStore } from "./store/sqliteStore";

const root = resolve(import.meta.dirname, "../../..");
try { process.loadEnvFile(join(root, ".env")); } catch { /* no .env: rely on the environment */ }

const token = process.env.MIA_DEV_TOKEN;
if (!token || token.length < 24 || token.startsWith("replace-with")) {
  throw new Error("Set your own MIA_DEV_TOKEN (≥ 24 random chars) in .env — see .env.example");
}

const dataDir = resolve(root, process.env.MIA_DATA_DIR ?? ".mia-data");
mkdirSync(dataDir, { recursive: true });
const store = new SqliteStore(join(dataDir, "mia.db"), new LocalAesCipher(loadOrCreateLocalKey(join(dataDir, "local.key"))));

const seeds = { rose, "rose-de": roseDe } as const;
const profileId = process.env.MIA_PROFILE ?? "rose";
if (!(profileId in seeds)) throw new Error(`MIA_PROFILE must be one of: ${Object.keys(seeds).join(", ")}`);
if (!(await store.getProfile(profileId))) await store.putProfile(seeds[profileId as keyof typeof seeds]());

const app = createHttpApp({
  tokens: new Map([[token, profileId]]),
  makeContext: (id) => ({ store, profileId: id, now: () => new Date(), alerts: new StoreAlertSink(store) }),
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
console.log(`[mia] LOCAL MODE — not production. MCP endpoint: http://127.0.0.1:${port}/mcp (profile: ${profileId})`);
