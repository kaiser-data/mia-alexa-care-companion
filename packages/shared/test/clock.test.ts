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

import { offsetClock } from "../src/domain/clock";

describe("offsetClock", () => {
  it("is the real clock without a start", () => {
    expect(offsetClock(undefined, () => 1000)().getTime()).toBe(1000);
  });
  it("starts at the given instant and then runs on", () => {
    let real = Date.parse("2026-10-20T18:00:00Z");
    const now = offsetClock("2026-10-21T07:58:00-04:00", () => real);
    expect(now().toISOString()).toBe("2026-10-21T11:58:00.000Z");
    real += 120_000;
    expect(now().toISOString()).toBe("2026-10-21T12:00:00.000Z");
  });
  it("refuses a start that is not a date", () => {
    expect(() => offsetClock("tomorrow")).toThrow(/MIA_CLOCK_START/);
  });
  it("refuses a start without an offset (it would be read in the host's zone)", () => {
    expect(() => offsetClock("2026-10-26T07:59:40")).toThrow(/MIA_CLOCK_START/);
    expect(() => offsetClock("2026-10-26")).toThrow(/MIA_CLOCK_START/);
    expect(() => offsetClock("2026-10-26T07:59:40Z", () => 0)).not.toThrow();
    expect(() => offsetClock("2026-10-26T07:59:40+01:00", () => 0)).not.toThrow();
  });
});
