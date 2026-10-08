import { describe, expect, it } from "vitest";
import { roseDe } from "@mia/shared";
import { at } from "@mia/shared/testing";
import { connect } from "./helpers";

const types = async (m: Awaited<ReturnType<typeof connect>>) =>
  (await m.store.eventsSince("rose", "2026-10-01T00:00:00Z")).map((e) => e.type);

describe("get_medication_status", () => {
  it("Monday 08:05, nothing taken: not yet, morning pills, description", async () => {
    const r = await (await connect(at("2026-10-12T08:05:00"))).call("get_medication_status");
    expect(r.say).toEqual(["Not yet.", "Now it's time for your morning pills.", "That's the small white pill and the round pink one."]);
  });
  it("after confirming: yes with time, next pills with part of day", async () => {
    const m = await connect(at("2026-10-12T08:05:00"));
    await m.call("confirm_medication");
    m.setNow(at("2026-10-12T09:30:00"));
    const r = await m.call("get_medication_status");
    expect(r.say).toEqual(["Yes. You took your morning pills at five past eight.", "Your next pills are at eight o'clock in the evening."]);
  });
  it("Monday 06:00: next pills in the morning", async () => {
    const r = await (await connect(at("2026-10-12T06:00:00"))).call("get_medication_status");
    expect(r.say).toEqual(["Your next pills are at eight o'clock in the morning."]);
  });
  it("German", async () => {
    const r = await (await connect(at("2026-10-12T08:05:00"), roseDe())).call("get_medication_status");
    expect(r.say).toEqual(["Noch nicht.", "Jetzt ist Zeit für deine Morgentabletten.", "Das ist die kleine weiße und die runde rosa Tablette."]);
  });
});

describe("confirm_medication", () => {
  it("logs due doses", async () => {
    const m = await connect(at("2026-10-12T08:05:00"));
    const r = await m.call("confirm_medication");
    expect(r.say).toEqual(["Thank you. I've noted your morning pills."]);
    const events = await m.store.eventsSince("rose", "2026-10-01T00:00:00Z");
    expect(events.at(-1)).toMatchObject({ type: "med_confirmed", detail: { medicationId: "morning-pills", doseTime: "08:00" } });
  });
  it("blocks a second dose kindly and logs the attempt", async () => {
    const m = await connect(at("2026-10-12T08:05:00"));
    await m.call("confirm_medication");
    m.setNow(at("2026-10-12T08:07:00"));
    const r = await m.call("confirm_medication");
    expect(r.say).toEqual(["You took your morning pills at five past eight.", "No more pills needed now."]);
    expect(await types(m)).toEqual(["med_confirmed", "med_duplicate_attempt"]);
  });
  it("too early: not yet, next time, logs not-due attempt", async () => {
    const m = await connect(at("2026-10-12T06:00:00"));
    const r = await m.call("confirm_medication");
    expect(r.say).toEqual(["Not yet.", "Your next pills are at eight o'clock in the morning."]);
    expect(await types(m)).toEqual(["med_not_due_attempt"]);
  });
  it("on a group day she went: the evening pill is confirmed and no pills remain", async () => {
    const m = await connect(at("2026-10-12T08:05:00"));
    await m.call("confirm_medication");
    await m.store.addEvent({ profileId: "rose", type: "left_home", at: "2026-10-12T13:38:00Z", detail: { appointmentId: "maple-grove" } });
    m.setNow(at("2026-10-12T21:00:00"));
    expect((await m.call("confirm_medication")).say).toEqual(["Thank you. I've noted your evening pill."]);
    const r = await m.call("get_medication_status");
    expect(r.say[1]).toBe("There are no more pills today.");
  });
  it("noon pill is due at home when the carer noted she stayed home", async () => {
    const m = await connect(at("2026-10-12T08:05:00"));
    await m.call("confirm_medication");
    await m.store.addEvent({ profileId: "rose", type: "stayed_home", at: "2026-10-12T14:00:00Z", detail: { appointmentId: "maple-grove" } });
    m.setNow(at("2026-10-12T12:30:00"));
    const r = await m.call("get_medication_status");
    expect(r.say).toEqual(["Not yet.", "Now it's time for your noon pill.", "That's the little yellow one."]);
  });
});

describe("unsure noon pill (no word whether she went to the group)", () => {
  it("never says take it: not sure, ask the carer first, logs med_unsure", async () => {
    const m = await connect(at("2026-10-12T08:05:00"));
    await m.call("confirm_medication");
    m.setNow(at("2026-10-12T14:45:00"));
    const r = await m.call("get_medication_status");
    expect(r.say).toEqual(["I'm not sure if you had your noon pill yet.", "Let's ask Tom first."]);
    expect(await types(m)).toEqual(["med_confirmed", "med_asked", "med_unsure"]);
  });
  it("German", async () => {
    const m = await connect(at("2026-10-12T08:05:00"), roseDe());
    await m.call("confirm_medication");
    m.setNow(at("2026-10-12T14:45:00"));
    const r = await m.call("get_medication_status");
    expect(r.say).toEqual(["Ich weiß nicht sicher, ob du deine Mittagstablette schon hattest.", "Wir fragen zuerst Tom."]);
  });
  it("if she says she took it, it is recorded (safe direction)", async () => {
    const m = await connect(at("2026-10-12T08:05:00"));
    await m.call("confirm_medication");
    m.setNow(at("2026-10-12T14:45:00"));
    expect((await m.call("confirm_medication")).say).toEqual(["Thank you. I've noted your noon pill."]);
    const events = await m.store.eventsSince("rose", "2026-10-01T00:00:00Z");
    expect(events.at(-2)).toMatchObject({ type: "med_confirmed", detail: { medicationId: "noon-pill", doseTime: "12:00" } });
  });
  it("a self-report of an unsure dose is recorded and flagged for the carer", async () => {
    const m = await connect(at("2026-10-12T08:05:00"));
    await m.call("confirm_medication");
    m.setNow(at("2026-10-12T14:45:00"));
    await m.call("confirm_medication");
    const events = await m.store.eventsSince("rose", "2026-10-01T00:00:00Z");
    expect(events.slice(-2)).toMatchObject([
      { type: "med_confirmed", detail: { medicationId: "noon-pill", doseTime: "12:00" } },
      { type: "med_unsure", detail: { medicationId: "noon-pill", doseTime: "12:00", selfReported: "true" } },
    ]);
  });
  it("evening due while noon is unsure: speaks the due dose, flags the unsure one silently", async () => {
    const m = await connect(at("2026-10-12T08:05:00"));
    await m.call("confirm_medication");
    m.setNow(at("2026-10-12T20:00:00"));
    const r = await m.call("get_medication_status");
    expect(r.say).toEqual(["Not yet.", "Now it's time for your evening pill.", "That's the white capsule."]);
    expect(await types(m)).toEqual(["med_confirmed", "med_asked", "med_unsure"]);
  });
});
