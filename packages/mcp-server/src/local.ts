import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { isSeedId, type Profile, SEED_PROFILES } from "@mia/shared";
import { StoreAlertSink } from "./alerts";
import { createHttpApp } from "./http";
import { LocalAesCipher, loadOrCreateLocalKey } from "./store/crypto";
import { SqliteStore } from "./store/sqliteStore";
import type { WeatherProvider } from "./weather";

export const MIN_TOKEN_LENGTH = 24;

/** Local mode only: the dev bearer token must be long and not the example placeholder. */
export function checkDevToken(token: string | undefined): string {
  if (!token || token.length < MIN_TOKEN_LENGTH || token.startsWith("replace-with")) {
    throw new Error("Set your own MIA_DEV_TOKEN (≥ 24 random chars) in .env — see .env.example");
  }
  return token;
}

/**
 * The profile from the environment: MIA_PROFILE_FILE (a private JSON profile, e.g. under .mia-data/, never committed)
 * wins over MIA_PROFILE (a seed id, default "rose").
 */
export function loadProfile(env: Record<string, string | undefined>): Profile {
  const file = env.MIA_PROFILE_FILE;
  if (!file) {
    const id = env.MIA_PROFILE ?? "rose";
    if (!isSeedId(id)) throw new Error(`MIA_PROFILE must be one of: ${Object.keys(SEED_PROFILES).join(", ")}`);
    return SEED_PROFILES[id]();
  }
  const p = JSON.parse(readFileSync(file, "utf8")) as Profile;
  const missing = (["id", "name", "preferredName", "locale", "timezone", "carerName", "routine", "medications", "appointments",
    "people", "comfortNotes", "lifeStory", "speech"] as const).filter((k) => p[k] === undefined);
  if (missing.length) throw new Error(`MIA_PROFILE_FILE is missing: ${missing.join(", ")}`);
  if (isSeedId(p.id)) throw new Error(`MIA_PROFILE_FILE: id "${p.id}" is a seed id; pick another`);
  if (p.locale !== "en-US" && p.locale !== "de-DE") throw new Error("MIA_PROFILE_FILE: locale must be en-US or de-DE");
  try { new Intl.DateTimeFormat("en", { timeZone: p.timezone }); } catch { throw new Error(`MIA_PROFILE_FILE: unknown timezone "${p.timezone}"`); }
  return p;
}

export interface LocalMiaOptions { token: string; profile: Profile; dataDir: string; port: number; weather?: WeatherProvider }

/** Starts the Mia MCP server in local mode (SQLite + local AES key) on 127.0.0.1. Port 0 picks a free port. */
export async function startLocalMia(o: LocalMiaOptions): Promise<{ url: string; close(): Promise<void> }> {
  checkDevToken(o.token);
  mkdirSync(o.dataDir, { recursive: true, mode: 0o700 });
  chmodSync(o.dataDir, 0o700);
  const store = new SqliteStore(join(o.dataDir, "mia.db"), new LocalAesCipher(loadOrCreateLocalKey(join(o.dataDir, "local.key"))));
  // Written on every start: edits to the profile take effect after a restart; her events and alerts are kept.
  await store.putProfile(o.profile);
  const app = createHttpApp({
    tokens: new Map([[o.token, o.profile.id]]),
    makeContext: (id) => ({ store, profileId: id, now: () => new Date(), alerts: new StoreAlertSink(store), weather: o.weather }),
  });
  const { server, port } = await new Promise<{ server: ReturnType<typeof serve>; port: number }>((resolve, reject) => {
    const s = serve({ fetch: app.fetch, port: o.port, hostname: "127.0.0.1" }, (info: AddressInfo) => resolve({ server: s, port: info.port }));
    s.once("error", (err) => { store.close(); reject(err); });
  });
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => {
      server.close(() => { store.close(); resolve(); });
      // Do not wait for idle keep-alive connections (e.g. the voice gateway's client).
      if ("closeAllConnections" in server) server.closeAllConnections();
    }),
  };
}
