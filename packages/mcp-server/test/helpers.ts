import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { rose, type Profile } from "@mia/shared";
import { EmailAlertSink, type Mailer, StoreAlertSink } from "../src/alerts";
import { createMiaServer } from "../src/server";
import { LocalAesCipher } from "../src/store/crypto";
import { SqliteStore } from "../src/store/sqliteStore";
import type { ToolContext } from "../src/tools/runtime";

export interface ToolReply { say: string[]; facts: any; verbatim: boolean; text: string }

/**
 * A Mia server on an in-memory store. Alerts are mailed with a fake mailer (a configured deployment) unless
 * `o.mailer` is null (no email configured: alerts are only stored) or another mailer.
 */
export async function connect(now: Date, profile: Profile = rose(), extra: Partial<ToolContext> = {}, o: { mailer?: Mailer | null } = {}) {
  const store = new SqliteStore(":memory:", new LocalAesCipher(randomBytes(32)));
  await store.putProfile(profile);
  let clock = now;
  const mails: { subject: string; text: string }[] = [];
  const mailer = o.mailer === undefined ? { send: async (m: { subject: string; text: string }) => { mails.push(m); } } : o.mailer;
  const alerts = mailer ? new EmailAlertSink(new StoreAlertSink(store), mailer, { now: () => clock }) : new StoreAlertSink(store);
  const server = createMiaServer({ store, profileId: profile.id, now: () => clock, alerts, ...extra });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mia-test", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return {
    client,
    store,
    mails,
    setNow: (d: Date) => { clock = d; },
    call: async (name: string, args: Record<string, unknown> = {}): Promise<ToolReply> => {
      const r = await client.callTool({ name, arguments: args });
      const sc = r.structuredContent as Omit<ToolReply, "text">;
      return { ...sc, text: (r.content as { type: string; text: string }[])[0]!.text };
    },
  };
}
