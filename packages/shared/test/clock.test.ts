import { describe, expect, it } from "vitest";
import { addDays, localParts, toMinutes } from "../src/domain/clock";

describe("localParts", () => {
  it("converts an instant to New York local time (EDT)", () => {
    expect(localParts(new Date("2026-10-12T12:05:00Z"), "America/New_York")).toEqual({
      date: "2026-10-12", time: "08:05", minutes: 485, weekday: 1,
    });
  });
  it("uses 00:xx, never 24:xx, at midnight", () => {
    expect(localParts(new Date("2026-10-13T04:00:00Z"), "America/New_York")).toMatchObject({
      date: "2026-10-13", time: "00:00", weekday: 2,
    });
  });
  it("handles Europe/Berlin (CEST)", () => {
    expect(localParts(new Date("2026-10-12T06:05:00Z"), "Europe/Berlin").time).toBe("08:05");
  });
  it("follows the US DST change on 2026-11-01", () => {
    expect(localParts(new Date("2026-11-02T13:00:00Z"), "America/New_York").time).toBe("08:00");
  });
});

describe("toMinutes", () => {
  it("parses HH:MM", () => expect(toMinutes("09:40")).toBe(580));
});

describe("addDays", () => {
  it("moves to the next day with ISO weekday", () => {
    expect(addDays("2026-10-12", 1)).toEqual({ date: "2026-10-13", weekday: 2 });
  });
  it("wraps Sunday to Monday", () => {
    expect(addDays("2026-10-18", 1)).toEqual({ date: "2026-10-19", weekday: 1 });
  });
});
