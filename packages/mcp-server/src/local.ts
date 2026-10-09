import { chmodSync, mkdirSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { SEED_PROFILES, type SeedId } from "@mia/shared";
import { StoreAlertSink } from "./alerts";
import { createHttpApp } from "./http";
import { LocalAesCipher, loadOrCreateLocalKey } from "./store/crypto";
import { SqliteStore } from "./store/sqliteStore";

export const MIN_TOKEN_LENGTH = 24;

/** Local mode only: the dev bearer token must be long and not the example placeholder. */
export function checkDevToken(token: string | undefined): string {
  if (!token || token.length < MIN_TOKEN_LENGTH || token.startsWith("replace-with")) {
    throw new Error("Set your own MIA_DEV_TOKEN (≥ 24 random chars) in .env — see .env.example");
  }
  return token;
}

export interface LocalMiaOptions { token: string; profileId: SeedId; dataDir: string; port: number }

/** Starts the Mia MCP server in local mode (SQLite + local AES key) on 127.0.0.1. Port 0 picks a free port. */
export async function startLocalMia(o: LocalMiaOptions): Promise<{ url: string; close(): Promise<void> }> {
  mkdirSync(o.dataDir, { recursive: true, mode: 0o700 });
  chmodSync(o.dataDir, 0o700);
  const store = new SqliteStore(join(o.dataDir, "mia.db"), new LocalAesCipher(loadOrCreateLocalKey(join(o.dataDir, "local.key"))));
  if (!(await store.getProfile(o.profileId))) await store.putProfile(SEED_PROFILES[o.profileId]());
  const app = createHttpApp({
    tokens: new Map([[o.token, o.profileId]]),
    makeContext: (id) => ({ store, profileId: id, now: () => new Date(), alerts: new StoreAlertSink(store) }),
  });
  const { server, port } = await new Promise<{ server: ReturnType<typeof serve>; port: number }>((resolve) => {
    const s = serve({ fetch: app.fetch, port: o.port, hostname: "127.0.0.1" }, (info: AddressInfo) => resolve({ server: s, port: info.port }));
  });
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
