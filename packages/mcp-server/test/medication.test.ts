import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rose, roseDe } from "@mia/shared";
import { at } from "@mia/shared/testing";
import { LocalAesCipher } from "../src/store/crypto";
import { SqliteStore } from "../src/store/sqliteStore";
import { connect } from "./helpers";

const types = async (m: Awaited<ReturnType<typeof connect>>) =>
  (await m.store.eventsSince("rose", "2026-10-01T00:00:00Z")).map((e) => e.type);

describe("get_medication_status", () => {
  it("Monday 08:05, nothing taken: morning pills, description; no \"Not yet\" lead on a due dose", async () => {
    const r = await (await connect(at("2026-10-12T08:05:00"))).call("get_medication_status");
    expect(r.say).toEqual(["Now it's time for your morning pills.", "That's the small white pill and the round pink one."]);
  });
  it("after confirming: taken with time, no more now, next pills with part of day; never a bare 'Yes.' (C-1)", async () => {
    const m = await connect(at("2026-10-12T08:05:00"));
    await m.call("confirm_medication");
    m.setNow(at("2026-10-12T09:30:00"));
    const r = await m.call("get_medication_status");
    expect(r.say).toEqual(["You took your morning pills at five past eight.", "No more pills needed now.", "Your next pills are at eight o'clock in the evening."]);
  });
  it("German after confirming: no 'Ja.', 'Jetzt brauchst du keine mehr.' (C-1)", async () => {
    const m = await connect(at("2026-10-14T08:05:00"), roseDe());
    await m.call("confirm_medication");
    m.setNow(at("2026-10-14T10:00:00"));
    const r = await m.call("get_medication_status");
    expect(r.say).toEqual(["Du hast deine Morgentabletten um fünf nach acht genommen.", "Jetzt brauchst du keine mehr.", "Die nächsten Tabletten sind um zwölf Uhr mittags."]);
  });
  it("Monday 06:00: next pills in the morning", async () => {
    const r = await (await connect(at("2026-10-12T06:00:00"))).call("get_medication_status");
    expect(r.say).toEqual(["Your next pills are at eight o'clock in the morning."]);
  });
  it("German", async () => {
    const r = await (await connect(at("2026-10-12T08:05:00"), roseDe())).call("get_medication_status");
    expect(r.say).toEqual(["Jetzt ist Zeit für deine Morgentabletten.", "Das ist die kleine weiße und die runde rosa Tablette."]);
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
  it("two hours before the dose: noted for the carer, logs not-due attempt", async () => {
    const m = await connect(at("2026-10-12T06:00:00"));
    const r = await m.call("confirm_medication");
    expect(r.say).toEqual(["Thank you. I'll tell Tom."]);
    expect(await types(m)).toEqual(["med_not_due_attempt", "med_unsure"]);
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
    expect(r.say).toEqual(["You took your morning pills at five past eight.", "Now it's time for your noon pill.", "That's the little yellow one."]);
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
    expect((await m.call("confirm_medication")).say).toEqual(["Thank you. I'll tell Tom."]);
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
    expect(r.say).toEqual(["You took your morning pills at five past eight.", "Now it's time for your evening pill.", "That's the white capsule."]);
    expect(await types(m)).toEqual(["med_confirmed", "med_asked", "med_unsure"]);
  });
});

describe("unsure policy: overdue and early reports", () => {
  const events = (m: Awaited<ReturnType<typeof connect>>) => m.store.eventsSince("rose", "2026-10-01T00:00:00Z");
  it("Wednesday 20:00, nothing taken: only the evening pill is due; morning and noon flagged as overdue", async () => {
    const m = await connect(at("2026-10-14T20:00:00"));
    const r = await m.call("get_medication_status");
    expect(r.say).toEqual(["Now it's time for your evening pill.", "That's the white capsule."]);
    const unsure = (await events(m)).filter((e) => e.type === "med_unsure");
    expect(unsure).toHaveLength(2);
    expect(unsure).toMatchObject([
      { detail: { medicationId: "morning-pills", doseTime: "08:00", reason: "overdue" } },
      { detail: { medicationId: "noon-pill", doseTime: "12:00", reason: "overdue" } },
    ]);
  });
  it("Wednesday 21:00: confirming records only the evening pill", async () => {
    const m = await connect(at("2026-10-14T21:00:00"));
    const r = await m.call("confirm_medication");
    expect(r.say).toEqual(["Thank you. I've noted your evening pill."]);
    const confirmed = (await events(m)).filter((e) => e.type === "med_confirmed");
    expect(confirmed).toMatchObject([{ detail: { medicationId: "evening-pill", doseTime: "20:00" } }]);
  });
  it("Wednesday 07:15 confirm: noted for the carer, then at 08:05 Mia is unsure", async () => {
    const m = await connect(at("2026-10-14T07:15:00"));
    expect((await m.call("confirm_medication")).say).toEqual(["Thank you. I'll tell Tom."]);
    expect(await types(m)).toEqual(["med_not_due_attempt", "med_unsure"]);
    m.setNow(at("2026-10-14T08:05:00"));
    const r = await m.call("get_medication_status");
    expect(r.say).toEqual(["I'm not sure if you had your morning pills yet.", "Let's ask Tom first."]);
    expect((await events(m)).at(-1)).toMatchObject({ type: "med_unsure", detail: { reason: "early_report" } });
  });
  it("an upcoming dose more than two hours away is unchanged", async () => {
    const m = await connect(at("2026-10-14T05:00:00"));
    expect((await m.call("confirm_medication")).say).toEqual(["Not yet.", "Your next pills are at eight o'clock in the morning."]);
  });
  it("German early report", async () => {
    const m = await connect(at("2026-10-14T07:15:00"), roseDe());
    expect((await m.call("confirm_medication")).say).toEqual(["Danke. Ich sage es Tom."]);
  });
});

describe("early self-report after an earlier dose was taken", () => {
  it("noon: 11:00 'I took my pills' is noted and flagged, 11:35 never says take it", async () => {
    const m = await connect(at("2026-10-14T08:05:00"));
    await m.call("confirm_medication");
    m.setNow(at("2026-10-14T11:00:00"));
    expect((await m.call("confirm_medication")).say).toEqual(["Thank you. I'll tell Tom."]);
    const events = await m.store.eventsSince("rose", "2026-10-01T00:00:00Z");
    expect(events.slice(-2)).toMatchObject([
      { type: "med_not_due_attempt", detail: { medicationId: "noon-pill", doseTime: "12:00" } },
      { type: "med_unsure", detail: { medicationId: "noon-pill", doseTime: "12:00", reason: "early_report", selfReported: "true" } },
    ]);
    m.setNow(at("2026-10-14T11:35:00"));
    const r = await m.call("get_medication_status");
    expect(r.say).toEqual(["I'm not sure if you had your noon pill yet.", "Let's ask Tom first."]);
  });
  it("evening: 18:30 report, 19:35 never says take it", async () => {
    const m = await connect(at("2026-10-14T08:05:00"));
    await m.call("confirm_medication");
    m.setNow(at("2026-10-14T12:05:00"));
    await m.call("confirm_medication");
    m.setNow(at("2026-10-14T18:30:00"));
    expect((await m.call("confirm_medication")).say).toEqual(["Thank you. I'll tell Tom."]);
    m.setNow(at("2026-10-14T19:35:00"));
    expect((await m.call("get_medication_status")).say).toEqual(["I'm not sure if you had your evening pill yet.", "Let's ask Tom first."]);
  });
  it("right after a dose, far from the next one, it is still a duplicate", async () => {
    const m = await connect(at("2026-10-14T08:05:00"));
    await m.call("confirm_medication");
    m.setNow(at("2026-10-14T08:07:00"));
    expect((await m.call("confirm_medication")).say).toEqual(["You took your morning pills at five past eight.", "No more pills needed now."]);
  });
});

describe("an unsure dose flags Tom with a medium alert (Codex #5)", () => {
  it("overdue and unconfirmed: one medium alert mailed, repeated questions are not mailed again", async () => {
    const m = await connect(at("2026-10-14T10:30:00"));
    expect((await m.call("get_medication_status")).say).toEqual(["I'm not sure if you had your morning pills yet.", "Let's ask Tom first."]);
    await m.call("get_medication_status");
    m.setNow(at("2026-10-14T11:00:00"));
    await m.call("get_medication_status");
    const alerts = await m.store.listAlerts("rose");
    expect(alerts[0]).toMatchObject({ rule: "med_unsure", severity: "medium" });
    expect(alerts[0]!.message).toContain("morning-pills");
    expect(m.mails.map((x) => x.subject)).toHaveLength(1);
  });
  it("a broken alert store does not stop the answer", async () => {
    const m = await connect(at("2026-10-14T10:30:00"));
    m.store.addAlert = async () => { throw new Error("disk full"); };
    expect((await m.call("get_medication_status")).say).toEqual(["I'm not sure if you had your morning pills yet.", "Let's ask Tom first."]);
  });
});

describe("after a pills-taken-twice alert no dose is prompted that day (Codex #2)", () => {
  it("08:05 'I took my pills twice' → the pill tool asks Tom first, never 'Now it's time'", async () => {
    const m = await connect(at("2026-10-12T08:05:00"));
    await m.call("report_problem", { what: "I took my pills twice" });
    m.setNow(at("2026-10-12T08:06:00"));
    const r = await m.call("get_medication_status");
    expect(r.say).toEqual(["I'm not sure if you had your morning pills yet.", "Let's ask Tom first."]);
    m.setNow(at("2026-10-12T20:05:00"));
    expect((await m.call("get_medication_status")).say.join(" ")).not.toContain("time for your");
  });
  it("German", async () => {
    const m = await connect(at("2026-10-12T08:05:00"), roseDe());
    await m.call("report_problem", { what: "Ich habe meine Tabletten genommen, schon wieder" });
    expect((await m.call("get_medication_status")).say).toEqual(["Ich weiß nicht sicher, ob du deine Morgentabletten schon hattest.", "Wir fragen zuerst Tom."]);
  });
  it("'I took my pills' under the hold records only doses already due and says Tom is told", async () => {
    const m = await connect(at("2026-10-12T08:05:00"));
    await m.call("report_problem", { what: "I took them again" });
    const r = await m.call("confirm_medication");
    expect(r.say).toEqual(["Thank you. I'll tell Tom."]);
    const confirmed = (await m.store.eventsSince("rose", "2026-10-01T00:00:00Z")).filter((e) => e.type === "med_confirmed");
    expect(confirmed.map((e) => e.detail?.medicationId)).toEqual(["morning-pills"]);
  });
  it("a fall does not hold the pills", async () => {
    const m = await connect(at("2026-10-12T08:05:00"));
    await m.call("report_problem", { what: "I fell" });
    expect((await m.call("get_medication_status")).say[0]).toBe("Now it's time for your morning pills.");
  });
  it("the hold is in the database: it survives a restart and ends the next day", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mia-hold-"));
    const key = randomBytes(32);
    const open = () => new SqliteStore(join(dir, "mia.db"), new LocalAesCipher(key));
    const first = open();
    await first.putProfile(rose());
    const m = await connect(at("2026-10-12T08:05:00"), rose(), { store: first });
    await m.call("report_problem", { what: "I took my pills twice" });
    first.close();
    const second = open();
    const again = await connect(at("2026-10-12T08:30:00"), rose(), { store: second });
    expect((await again.call("get_medication_status")).say).toEqual(["I'm not sure if you had your morning pills yet.", "Let's ask Tom first."]);
    again.setNow(at("2026-10-13T08:05:00"));
    expect((await again.call("get_medication_status")).say[0]).toBe("Now it's time for your morning pills.");
    second.close();
  });
  it("the alert goes out even when the hold cannot be written", async () => {
    const m = await connect(at("2026-10-12T08:05:00"));
    const addEvent = m.store.addEvent.bind(m.store);
    m.store.addEvent = async (e) => { if (e.type === "med_hold") throw new Error("disk full"); await addEvent(e); };
    const r = await m.call("report_problem", { what: "I took my pills twice" });
    expect(r.facts.alerted).toBe(true);
    expect(await m.store.listAlerts("rose")).toMatchObject([{ rule: "distress", severity: "high" }]);
  });
});
