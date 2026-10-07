import { describe, expect, it } from "vitest";
import { dateWords, joinList, timeWords, weekdayName } from "../src/i18n/words";

describe("timeWords en-US", () => {
  it.each([
    ["08:00", "eight o'clock"], ["14:30", "half past two"], ["09:40", "twenty to ten"],
    ["08:15", "quarter past eight"], ["19:45", "quarter to eight"], ["12:00", "twelve o'clock"],
    ["00:05", "five past twelve"], ["08:12", "about ten past eight"], ["08:13", "about quarter past eight"],
  ])("%s → %s", (t, w) => expect(timeWords(t, "en-US")).toBe(w));
  it("adds the part of day", () => {
    expect(timeWords("20:00", "en-US", { withPart: true })).toBe("eight o'clock in the evening");
    expect(timeWords("08:00", "en-US", { withPart: true })).toBe("eight o'clock in the morning");
    expect(timeWords("12:00", "en-US", { withPart: true })).toBe("twelve noon");
    expect(timeWords("03:10", "en-US", { withPart: true })).toBe("ten past three at night");
  });
});

describe("timeWords de-DE", () => {
  it.each([
    ["08:00", "acht Uhr"], ["13:00", "ein Uhr"], ["14:30", "halb drei"], ["09:40", "zwanzig vor zehn"],
    ["08:15", "Viertel nach acht"], ["09:25", "fünf vor halb zehn"], ["09:35", "fünf nach halb zehn"],
    ["19:45", "Viertel vor acht"], ["08:12", "etwa zehn nach acht"], ["01:30", "halb zwei"],
  ])("%s → %s", (t, w) => expect(timeWords(t, "de-DE")).toBe(w));
  it("adds the part of day", () => {
    expect(timeWords("20:00", "de-DE", { withPart: true })).toBe("acht Uhr abends");
    expect(timeWords("12:00", "de-DE", { withPart: true })).toBe("zwölf Uhr mittags");
  });
});

describe("dates and lists", () => {
  it("weekday names", () => {
    expect(weekdayName(1, "en-US")).toBe("Monday");
    expect(weekdayName(7, "de-DE")).toBe("Sonntag");
  });
  it("date words", () => {
    expect(dateWords("2026-10-12", 1, "en-US")).toBe("Monday, October 12");
    expect(dateWords("2026-10-12", 1, "de-DE")).toBe("Montag, der 12. Oktober");
  });
  it("joins lists", () => {
    expect(joinList(["a"], "en-US")).toBe("a");
    expect(joinList(["a", "b"], "en-US")).toBe("a and b");
    expect(joinList(["a", "b", "c"], "de-DE")).toBe("a, b und c");
  });
});
