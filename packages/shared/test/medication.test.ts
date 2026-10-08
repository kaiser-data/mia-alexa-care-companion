import { describe, expect, it } from "vitest";
import { at } from "../src/testing";
import { rose } from "../src/seed/rose";
import { doseStatuses } from "../src/domain/medication";
import type { CareEvent } from "../src/domain/types";

const confirmed = (medicationId: string, doseTime: string, iso: string): CareEvent =>
  ({ profileId: "rose", type: "med_confirmed", at: iso, detail: { medicationId, doseTime } });

const states = (s: ReturnType<typeof doseStatuses>) => s.map((d) => [d.medicationId, d.state]);

describe("doseStatuses", () => {
  it("Monday 08:05: morning due, noon at group, evening upcoming", () => {
    const s = doseStatuses(rose(), [], at("2026-10-12T08:05:00"));
    expect(states(s)).toEqual([["morning-pills", "due"], ["noon-pill", "at_appointment"], ["evening-pill", "upcoming"]]);
    expect(s[1]!.appointmentName).toBe("Maple Grove Day Club");
  });
  it("Wednesday 12:00: noon pill is due at home (no group)", () => {
    expect(doseStatuses(rose(), [], at("2026-10-14T12:00:00"))[1]!.state).toBe("due");
  });
  it("due window opens 30 minutes before", () => {
    expect(doseStatuses(rose(), [], at("2026-10-12T07:29:00"))[0]!.state).toBe("upcoming");
    expect(doseStatuses(rose(), [], at("2026-10-12T07:30:00"))[0]!.state).toBe("due");
  });
  it("a confirmation today marks the dose taken with local time", () => {
    const s = doseStatuses(rose(), [confirmed("morning-pills", "08:00", "2026-10-12T12:06:00Z")], at("2026-10-12T09:00:00"));
    expect(s[0]).toMatchObject({ state: "taken", takenAt: "08:06" });
  });
  it("a confirmation yesterday does not count today", () => {
    const s = doseStatuses(rose(), [confirmed("morning-pills", "08:00", "2026-10-11T12:06:00Z")], at("2026-10-12T08:10:00"));
    expect(s[0]!.state).toBe("due");
  });
  const left = (iso: string): CareEvent => ({ profileId: "rose", type: "left_home", at: iso, detail: { appointmentId: "maple-grove" } });
  const stayed = (iso: string): CareEvent => ({ profileId: "rose", type: "stayed_home", at: iso, detail: { appointmentId: "maple-grove" } });
  it("Monday 12:30, no word whether she went: noon pill is unsure", () => {
    const s = doseStatuses(rose(), [], at("2026-10-12T12:30:00"));
    expect(s[1]).toMatchObject({ state: "unsure", appointmentName: "Maple Grove Day Club" });
  });
  it("Monday 12:30, carer noted she stayed home: noon pill is due at home", () => {
    expect(doseStatuses(rose(), [stayed("2026-10-12T14:00:00Z")], at("2026-10-12T12:30:00"))[1]!.state).toBe("due");
  });
  it("Monday 12:30, she left for the group: noon pill given there", () => {
    expect(doseStatuses(rose(), [left("2026-10-12T14:00:00Z")], at("2026-10-12T12:30:00"))[1]!.state).toBe("at_appointment");
  });
  it("leaving yesterday does not count today", () => {
    expect(doseStatuses(rose(), [left("2026-10-11T14:00:00Z")], at("2026-10-12T12:30:00"))[1]!.state).toBe("unsure");
  });
  it("a departure logged after now does not count", () => {
    expect(doseStatuses(rose(), [left("2026-10-12T17:00:00Z")], at("2026-10-12T12:30:00"))[1]!.state).toBe("unsure");
  });
  it("a confirmed noon dose stays taken even without a departure", () => {
    const s = doseStatuses(rose(), [confirmed("noon-pill", "12:00", "2026-10-12T16:10:00Z")], at("2026-10-12T12:30:00"));
    expect(s[1]).toMatchObject({ state: "taken", takenAt: "12:10" });
  });
});
