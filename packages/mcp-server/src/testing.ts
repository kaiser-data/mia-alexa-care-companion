import { randomBytes } from "node:crypto";
import { rose, type Profile } from "@mia/shared";
import type { Hono } from "hono";
import { StoreAlertSink } from "./alerts";
import { createHttpApp } from "./http";
import { LocalAesCipher } from "./store/crypto";
import { SqliteStore } from "./store/sqliteStore";

/** An in-memory Mia server for tests in any package: real tools, real encryption, no network. */
export async function inMemoryMia(o: { now: () => Date; profile?: Profile }) {
  const store = new SqliteStore(":memory:", new LocalAesCipher(randomBytes(32)));
  const profile = o.profile ?? rose();
  await store.putProfile(profile);
  const token = "test-token-0123456789abcdef";
  const app: Hono = createHttpApp({
    tokens: new Map([[token, profile.id]]),
    makeContext: (id) => ({ store, profileId: id, now: o.now, alerts: new StoreAlertSink(store) }),
  });
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) =>
    app.request(url instanceof Request ? url : url.toString(), init)) as typeof fetch;
  return { app, store, token, url: "http://mia.test", fetch: fetchFn };
}
