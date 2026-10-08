import { toMinutes } from "../domain/clock";
import { partOfDay, type PartOfDay } from "../domain/today";
import type { HHMM, Locale, Weekday } from "../domain/types";

const EN_HOURS = ["twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"];
const DE_HOURS = ["zwölf", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf"];
const EN_MIN: Record<number, string> = { 5: "five", 10: "ten", 20: "twenty", 25: "twenty-five" };
const EN_PART: Record<PartOfDay, string> = { morning: "in the morning", afternoon: "in the afternoon", evening: "in the evening", night: "at night" };
const DE_PART: Record<PartOfDay, string> = { morning: "morgens", afternoon: "nachmittags", evening: "abends", night: "nachts" };

function en(h: number, m: number): string {
  const hr = EN_HOURS[h % 12]!;
  const next = EN_HOURS[(h + 1) % 12]!;
  if (m === 0) return `${hr} o'clock`;
  if (m === 15) return `quarter past ${hr}`;
  if (m === 30) return `half past ${hr}`;
  if (m === 45) return `quarter to ${next}`;
  return m < 30 ? `${EN_MIN[m]} past ${hr}` : `${EN_MIN[60 - m]} to ${next}`;
}

function de(h: number, m: number): string {
  const hr = DE_HOURS[h % 12]!;
  const next = DE_HOURS[(h + 1) % 12]!;
  switch (m) {
    case 0: return `${h % 12 === 1 ? "ein" : hr} Uhr`;
    case 5: return `fünf nach ${hr}`;
    case 10: return `zehn nach ${hr}`;
    case 15: return `Viertel nach ${hr}`;
    case 20: return `zwanzig nach ${hr}`;
    case 25: return `fünf vor halb ${next}`;
    case 30: return `halb ${next}`;
    case 35: return `fünf nach halb ${next}`;
    case 40: return `zwanzig vor ${next}`;
    case 45: return `Viertel vor ${next}`;
    case 50: return `zehn vor ${next}`;
    default: return `fünf vor ${next}`;
  }
}

export function timeWords(t: HHMM, locale: Locale, opts: { withPart?: boolean } = {}): string {
  const total = toMinutes(t);
  const rounded = (Math.round(total / 5) * 5) % 1440;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  const isDe = locale === "de-DE";
  let words: string;
  if (opts.withPart && rounded === 720) words = isDe ? "zwölf Uhr mittags" : "twelve noon";
  else {
    words = isDe ? de(h, m) : en(h, m);
    if (opts.withPart) words += ` ${(isDe ? DE_PART : EN_PART)[partOfDay(rounded)]}`;
  }
  if (rounded !== total) words = `${isDe ? "etwa" : "about"} ${words}`;
  return words;
}

const WEEKDAYS: Record<Locale, string[]> = {
  "en-US": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  "de-DE": ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"],
};
const MONTHS: Record<Locale, string[]> = {
  "en-US": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  "de-DE": ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
};

export function weekdayName(w: Weekday, locale: Locale): string {
  return WEEKDAYS[locale][w - 1]!;
}

export function dateWords(date: string, weekday: Weekday, locale: Locale): string {
  const [, month, day] = date.split("-").map(Number);
  const wd = weekdayName(weekday, locale);
  const mon = MONTHS[locale][month! - 1]!;
  return locale === "de-DE" ? `${wd}, der ${day}. ${mon}` : `${wd}, ${mon} ${day}`;
}

export function joinList(items: string[], locale: Locale): string {
  if (items.length <= 1) return items[0] ?? "";
  const and = locale === "de-DE" ? "und" : "and";
  return `${items.slice(0, -1).join(", ")} ${and} ${items.at(-1)}`;
}
