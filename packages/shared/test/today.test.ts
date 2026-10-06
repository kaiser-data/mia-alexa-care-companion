import { describe, expect, it } from "vitest";
import { at } from "../src/testing";
import { rose } from "../src/seed/rose";
import { appointmentsOn, nextAppointment, partOfDay, todayView } from "../src/domain/today";

describe("appointmentsOn", () => {
  it("finds the group on Monday", () => {
    expect(appointmentsOn(rose(), "2026-10-12", 1).map((a) => a.id)).toEqual(["maple-grove"]);
  });
  it("finds nothing on Wednesday", () => {
    expect(appointmentsOn(rose(), "2026-10-14", 3)).toEqual([]);
  });
  it("skips cancelled dates", () => {
    const p = rose();
    p.appointments[0]!.cancelledDates = ["2026-10-15"];
    expect(appointmentsOn(p, "2026-10-15", 4)).toEqual([]);
  });
  it("supports one-off dates", () => {
    const p = rose();
    p.appointments.push({ ...p.appointments[0]!, id: "dentist", name: "the dentist", aliases: [], weekdays: undefined, date: "2026-10-14", start: "11:00", end: "12:00" });
    expect(appointmentsOn(p, "2026-10-14", 3).map((a) => a.id)).toEqual(["dentist"]);
  });
});

describe("partOfDay", () => {
  it.each([[180, "night"], [300, "morning"], [720, "afternoon"], [1020, "evening"], [1320, "night"]] as const)(
    "%i minutes → %s", (m, expected) => expect(partOfDay(m)).toBe(expected),
  );
});

describe("todayView", () => {
  it("Monday 08:05: group today, lunch next", () => {
    const v = todayView(rose(), at("2026-10-12T08:05:00"));
    expect(v).toMatchObject({ date: "2026-10-12", weekday: 1, time: "08:05", partOfDay: "morning" });
    expect(v.appointments.map((a) => a.id)).toEqual(["maple-grove"]);
    expect(v.nextRoutine?.label).toBe("lunch");
  });
});

describe("nextAppointment", () => {
  it("Wednesday: next group is Thursday", () => {
    const n = nextAppointment(rose(), at("2026-10-14T10:00:00"), "group");
    expect(n).toMatchObject({ date: "2026-10-15", weekday: 4, daysAway: 1 });
  });
  it("Monday 11:00: group is ongoing today", () => {
    expect(nextAppointment(rose(), at("2026-10-12T11:00:00"))?.daysAway).toBe(0);
  });
  it("Monday 15:00: group over, next is Tuesday", () => {
    expect(nextAppointment(rose(), at("2026-10-12T15:00:00"))).toMatchObject({ date: "2026-10-13", daysAway: 1 });
  });
  it("matches German alias words inside a sentence", () => {
    const p = rose();
    p.appointments[0]!.aliases.push("gruppe");
    expect(nextAppointment(p, at("2026-10-14T10:00:00"), "meine Gruppe")?.weekday).toBe(4);
  });
  it("returns null for unknown appointments", () => {
    expect(nextAppointment(rose(), at("2026-10-12T08:00:00"), "dentist")).toBeNull();
  });
});
