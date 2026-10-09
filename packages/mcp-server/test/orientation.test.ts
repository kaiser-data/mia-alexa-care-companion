import { describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { roseDe } from "@mia/shared";
import { at } from "@mia/shared/testing";
import { StoreAlertSink } from "../src/alerts";
import { createMiaServer } from "../src/server";
import { LocalAesCipher } from "../src/store/crypto";
import { SqliteStore } from "../src/store/sqliteStore";
import { connect } from "./helpers";

describe("run() fallback", () => {
  it("profile does not exist: calm fallback", async () => {
    const store = new SqliteStore(":memory:", new LocalAesCipher(randomBytes(32)));
    let clock = at("2026-10-12T08:05:00");
    const server = createMiaServer({ store, profileId: "nobody", now: () => clock, alerts: new StoreAlertSink(store) });
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "mia-test", version: "0.0.0" });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await client.callTool({ name: "get_today", arguments: {} });
      const sc = r.structuredContent as any;
      const content = r.content as { type: string; text: string }[];

      expect(sc).toEqual({ facts: { error: "unavailable" }, say: ["I can't check right now. Your family can help."], verbatim: true, guidance: expect.any(String) });
      expect(content[0]?.text).toBe("I can't check right now. Your family can help.");
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("get_today", () => {
  it("Monday 08:05: date, leave time for the group, day repeated", async () => {
    const m = await connect(at("2026-10-12T08:05:00"));
    const r = await m.call("get_today");
    expect(r.say).toEqual([
      "Today is Monday, October 12.",
      "You leave for Maple Grove Day Club at twenty to ten.",
      "Today is Monday.",
    ]);
    expect(r.verbatim).toBe(true);
    expect(r.text).toBe(r.say.join(" "));
    expect((await m.store.eventsSince("rose", "2026-10-01T00:00:00Z")).map((e) => e.type)).toEqual(["orientation_asked"]);
  });
  it("Monday 11:00 during the group: says until when", async () => {
    const r = await (await connect(at("2026-10-12T11:00:00"))).call("get_today");
    expect(r.say[1]).toBe("Maple Grove Day Club goes until two o'clock.");
  });
  it("Wednesday 15:10: next routine item", async () => {
    const r = await (await connect(at("2026-10-14T15:10:00"))).call("get_today");
    expect(r.say[1]).toBe("Next is supper, at six o'clock in the evening.");
  });
  it("Wednesday 22:00: nothing planned", async () => {
    const r = await (await connect(at("2026-10-14T22:00:00"))).call("get_today");
    expect(r.say[1]).toBe("Nothing special is planned today.");
  });
  it("German", async () => {
    const r = await (await connect(at("2026-10-12T08:05:00"), roseDe())).call("get_today");
    expect(r.say).toEqual([
      "Heute ist Montag, der 12. Oktober.",
      "Tagesgruppe ist heute. Du gehst um zwanzig vor zehn los.",
      "Heute ist Montag.",
    ]);
  });
});

describe("get_next_appointment", () => {
  it("Wednesday: not today, Thursday", async () => {
    const r = await (await connect(at("2026-10-14T10:00:00"))).call("get_next_appointment", { name: "my group" });
    expect(r.say).toEqual(["Not today. Maple Grove Day Club is on Thursday.", "On Thursday."]);
  });
  it("Monday 08:05: yes, today", async () => {
    const r = await (await connect(at("2026-10-12T08:05:00"))).call("get_next_appointment", { name: "group" });
    expect(r.say).toEqual(["Yes, Maple Grove Day Club is today.", "You leave at twenty to ten."]);
  });
  it("German Monday 08:05: the group is named only once", async () => {
    const r = await (await connect(at("2026-10-12T08:05:00"), roseDe())).call("get_next_appointment", { name: "Gruppe" });
    expect(r.say).toEqual(["Ja, Tagesgruppe ist heute.", "Du gehst um zwanzig vor zehn los."]);
  });
  it("Monday 15:00 after the group: next is Tuesday", async () => {
    const r = await (await connect(at("2026-10-12T15:00:00"))).call("get_next_appointment", { name: "group" });
    expect(r.say).toEqual(["Not today. Maple Grove Day Club is on Tuesday.", "On Tuesday."]);
  });
  it("unknown appointment: don't know, logs the question", async () => {
    const m = await connect(at("2026-10-12T08:05:00"));
    const r = await m.call("get_next_appointment", { name: "dentist" });
    expect(r.say).toEqual(["I don't know that. I'll ask Tom."]);
    const events = await m.store.eventsSince("rose", "2026-10-01T00:00:00Z");
    expect(events.at(-1)).toMatchObject({ type: "unknown_question", detail: { topic: "appointment", query: "dentist" } });
  });
});

describe("get_preparation_steps", () => {
  it("two items at a time, then that's everything", async () => {
    const m = await connect(at("2026-10-12T09:00:00"));
    const first = await m.call("get_preparation_steps");
    expect(first.say).toEqual(["Take your keys on the red lanyard and your handbag."]);
    expect(first.facts).toMatchObject({ nextStep: 1, hasMore: true });
    expect((await m.call("get_preparation_steps", { step: 1 })).say).toEqual(["Take your glasses and your coat."]);
    const last = await m.call("get_preparation_steps", { step: 2 });
    expect(last.say).toEqual(["That's everything."]);
    expect(last.facts).toMatchObject({ hasMore: false });
  });
  it("nothing planned today", async () => {
    const r = await (await connect(at("2026-10-14T09:00:00"))).call("get_preparation_steps");
    expect(r.say).toEqual(["Nothing special is planned today."]);
  });
});

describe("night_reassurance", () => {
  it("03:10: middle of the night, safe, logs night_awake", async () => {
    const m = await connect(at("2026-10-13T03:10:00"));
    const r = await m.call("night_reassurance");
    expect(r.say).toEqual(["It's ten past three, in the middle of the night.", "You're safe at home. You can go back to sleep."]);
    expect((await m.store.eventsSince("rose", "2026-10-01T00:00:00Z")).map((e) => e.type)).toEqual(["night_awake"]);
  });
  it("during the day it answers like get_today", async () => {
    const r = await (await connect(at("2026-10-12T08:05:00"))).call("night_reassurance");
    expect(r.say[0]).toBe("Today is Monday, October 12.");
  });
});
