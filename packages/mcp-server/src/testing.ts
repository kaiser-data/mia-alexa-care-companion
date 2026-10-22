import { randomBytes } from "node:crypto";
import { rose, type Profile } from "@mia/shared";
import type { Hono } from "hono";
import { EmailAlertSink, type Mailer, StoreAlertSink } from "./alerts";
import { createHttpApp } from "./http";
import { LocalAesCipher } from "./store/crypto";
import { SqliteStore } from "./store/sqliteStore";
import type { WeatherProvider } from "./weather";

/**
 * An in-memory Mia server for tests in any package: real tools, real encryption, no network.
 * Alert mails go to `mails` (a configured deployment) unless `mailer` is null (no email: alerts are only stored).
 */
export async function inMemoryMia(o: { now: () => Date; profile?: Profile; weather?: WeatherProvider; mailer?: Mailer | null }) {
  const store = new SqliteStore(":memory:", new LocalAesCipher(randomBytes(32)));
  const profile = o.profile ?? rose();
  await store.putProfile(profile);
  const mails: { subject: string; text: string }[] = [];
  const mailer = o.mailer === undefined ? { send: async (m: { subject: string; text: string }) => { mails.push(m); } } : o.mailer;
  const alerts = mailer ? new EmailAlertSink(new StoreAlertSink(store), mailer, { now: o.now }) : new StoreAlertSink(store);
  const token = "test-token-0123456789abcdef";
  const app: Hono = createHttpApp({
    tokens: new Map([[token, profile.id]]),
    makeContext: (id) => ({ store, profileId: id, now: o.now, alerts, weather: o.weather }),
  });
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) =>
    app.request(url instanceof Request ? url : url.toString(), init)) as typeof fetch;
  return { app, store, token, mails, url: "http://mia.test", fetch: fetchFn };
}
