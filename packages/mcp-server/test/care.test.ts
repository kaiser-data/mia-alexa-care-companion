import { describe, expect, it } from "vitest";
import { roseDe } from "@mia/shared";
import { at } from "@mia/shared/testing";
import { connect } from "./helpers";

const lastEvent = async (m: Awaited<ReturnType<typeof connect>>) =>
  (await m.store.eventsSince("rose", "2026-10-01T00:00:00Z")).at(-1);

describe("outings", () => {
  it("leaving for the group: lovely time, keys, logs appointment", async () => {
    const m = await connect(at("2026-10-12T09:38:00"));
    const r = await m.call("report_leaving");
    expect(r.say).toEqual(["Have a lovely time.", "Do you have your keys?"]);
    expect(await lastEvent(m)).toMatchObject({ type: "left_home", detail: { appointmentId: "maple-grove" } });
  });
  it("leaving long before the group is not counted as going to the group", async () => {
    const m = await connect(at("2026-10-12T07:30:00"));
    await m.call("report_leaving");
    const e = await lastEvent(m);
    expect(e?.type).toBe("left_home");
    expect(e?.detail).toBeUndefined();
  });
  it("coming home: welcome by name", async () => {
    const m = await connect(at("2026-10-12T14:25:00"));
    const r = await m.call("report_home");
    expect(r.say).toEqual(["Welcome home, Rose.", "Did you have a nice time?"]);
    expect((await lastEvent(m))?.type).toBe("arrived_home");
  });
});

describe("comfort", () => {
  it("comfort_me: first comfort note, call offer, logs anxious", async () => {
    const m = await connect(at("2026-10-12T16:30:00"));
    const r = await m.call("comfort_me");
    expect(r.say).toEqual(["You're safe at home on Linden Street.", "Shall I ask Tom to call you?"]);
    expect((await lastEvent(m))?.type).toBe("anxious");
  });
  it("request_call: confirms and raises a medium alert", async () => {
    const m = await connect(at("2026-10-12T16:31:00"));
    const r = await m.call("request_call");
    expect(r.say).toEqual(["I've asked Tom to call you."]);
    expect(await m.store.listAlerts("rose")).toMatchObject([{ rule: "call_requested", severity: "medium", message: "Rose would like a call." }]);
  });
  it("chat_about_life: not verbatim, suggests a life-story topic", async () => {
    const m = await connect(at("2026-10-14T15:00:00"));
    const r = await m.call("chat_about_life");
    expect(r.verbatim).toBe(false);
    expect(r.say).toEqual([]);
    expect(r.facts.topics).toHaveLength(6);
    expect(r.facts.topics).toContain(r.facts.suggestedTopic);
    expect(r.text).toContain(r.facts.suggestedTopic);
    expect((await lastEvent(m))?.type).toBe("lonely");
  });
});

describe("who_is", () => {
  it.each(["Tom", "my son", "who is tom?"])("finds Tom from %s", async (name) => {
    const r = await (await connect(at("2026-10-12T10:00:00"))).call("who_is", { name });
    expect(r.say).toEqual(["Tom is your son.", "Tom calls you every evening at seven."]);
  });
  it("uses notes when there is no contact", async () => {
    const r = await (await connect(at("2026-10-12T10:00:00"))).call("who_is", { name: "Frank" });
    expect(r.say).toEqual(["Frank is your husband.", "Frank loved you very much."]);
  });
  it("German relationship includes the possessive", async () => {
    const r = await (await connect(at("2026-10-12T10:00:00"), roseDe())).call("who_is", { name: "mein Sohn" });
    expect(r.say[0]).toBe("Tom ist dein Sohn.");
  });
  it("unknown person: don't know, logs question", async () => {
    const m = await connect(at("2026-10-12T10:00:00"));
    expect((await m.call("who_is", { name: "Peter" })).say).toEqual(["I don't know that. I'll ask Tom."]);
    expect(await lastEvent(m)).toMatchObject({ type: "unknown_question", detail: { topic: "person", query: "Peter" } });
  });
});

describe("report_problem", () => {
  it("raises a high alert immediately and reassures", async () => {
    const m = await connect(at("2026-10-12T11:00:00"));
    const r = await m.call("report_problem", { what: "I fell" });
    expect(r.say).toEqual(["I've let Tom know right away.", "Tom will get in touch with you."]);
    expect(await m.store.listAlerts("rose")).toMatchObject([{ rule: "distress", severity: "high", message: 'Rose asked for help: "I fell".' }]);
    expect((await lastEvent(m))?.type).toBe("distress");
  });
  it("the alert still goes out when writing the log fails", async () => {
    const m = await connect(at("2026-10-12T11:00:00"));
    m.store.addEvent = async () => { throw new Error("disk full"); };
    const r = await m.call("report_problem", { what: "I fell" });
    expect(r.say).toEqual(["I've let Tom know right away.", "Tom will get in touch with you."]);
    expect(await m.store.listAlerts("rose")).toMatchObject([{ rule: "distress", severity: "high" }]);
  });
});

describe("repeat_last", () => {
  it("repeats the last answer verbatim and asks to slow down", async () => {
    const m = await connect(at("2026-10-12T08:05:00"));
    const first = await m.call("get_today");
    const again = await m.call("repeat_last");
    expect(again.say).toEqual(first.say);
    expect(again.facts.slower).toBe(true);
    const twice = await m.call("repeat_last");
    expect(twice.say).toEqual(first.say);
  });
  it("with nothing to repeat, gives today", async () => {
    const r = await (await connect(at("2026-10-12T08:05:00"))).call("repeat_last");
    expect(r.say[0]).toBe("Today is Monday, October 12.");
  });
});
