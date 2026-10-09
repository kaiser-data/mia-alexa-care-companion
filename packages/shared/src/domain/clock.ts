import type { HHMM, Weekday } from "./types";

export interface LocalParts { date: string; time: HHMM; minutes: number; weekday: Weekday }

const WEEKDAY: Record<string, Weekday> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function toMinutes(t: HHMM): number {
  const [h, m] = t.split(":").map(Number);
  return h! * 60 + m!;
}

export function localParts(instant: Date, timeZone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
  });
  const p = Object.fromEntries(fmt.formatToParts(instant).map((x) => [x.type, x.value]));
  const time = `${p.hour}:${p.minute}`;
  return { date: `${p.year}-${p.month}-${p.day}`, time, minutes: toMinutes(time), weekday: WEEKDAY[p.weekday!]! };
}

export function addDays(date: string, n: number): { date: string; weekday: Weekday } {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  const wd = d.getUTCDay();
  return { date: d.toISOString().slice(0, 10), weekday: (wd === 0 ? 7 : wd) as Weekday };
}
