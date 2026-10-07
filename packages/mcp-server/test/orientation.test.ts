import { describe, expect, it } from "vitest";
import { roseDe } from "@mia/shared";
import { at } from "@mia/shared/testing";
import { connect } from "./helpers";

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
    expect(r.say).toEqual(["Yes, Maple Grove Day Club is today.", "You leave for Maple Grove Day Club at twenty to ten."]);
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
    expect((await m.call("get_preparation_steps", { step: 2 })).say).toEqual(["That's everything."]);
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
