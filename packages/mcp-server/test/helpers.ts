import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { rose, type Profile } from "@mia/shared";
import { StoreAlertSink } from "../src/alerts";
import { createMiaServer } from "../src/server";
import { LocalAesCipher } from "../src/store/crypto";
import { SqliteStore } from "../src/store/sqliteStore";

export interface ToolReply { say: string[]; facts: any; verbatim: boolean; text: string }

export async function connect(now: Date, profile: Profile = rose()) {
  const store = new SqliteStore(":memory:", new LocalAesCipher(randomBytes(32)));
  await store.putProfile(profile);
  let clock = now;
  const server = createMiaServer({ store, profileId: profile.id, now: () => clock, alerts: new StoreAlertSink(store) });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mia-test", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return {
    client,
    store,
    setNow: (d: Date) => { clock = d; },
    call: async (name: string, args: Record<string, unknown> = {}): Promise<ToolReply> => {
      const r = await client.callTool({ name, arguments: args });
      const sc = r.structuredContent as Omit<ToolReply, "text">;
      return { ...sc, text: (r.content as { type: string; text: string }[])[0]!.text };
    },
  };
}
