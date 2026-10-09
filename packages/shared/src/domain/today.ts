import { addDays, localParts, toMinutes } from "./clock";
import type { Appointment, HHMM, Profile, RoutineItem, Weekday } from "./types";

export type PartOfDay = "morning" | "afternoon" | "evening" | "night";

export function partOfDay(minutes: number): PartOfDay {
  if (minutes >= 300 && minutes < 720) return "morning";
  if (minutes >= 720 && minutes < 1020) return "afternoon";
  if (minutes >= 1020 && minutes < 1320) return "evening";
  return "night";
}

export function occursOn(a: Appointment, date: string, weekday: Weekday): boolean {
  if (a.cancelledDates.includes(date)) return false;
  if (a.date) return a.date === date;
  return (a.weekdays ?? []).includes(weekday);
}

const byStart = (x: Appointment, y: Appointment) => toMinutes(x.start) - toMinutes(y.start);

export function appointmentsOn(p: Profile, date: string, weekday: Weekday): Appointment[] {
  return p.appointments.filter((a) => occursOn(a, date, weekday)).sort(byStart);
}

export interface TodayView {
  date: string;
  weekday: Weekday;
  time: HHMM;
  minutes: number;
  partOfDay: PartOfDay;
  appointments: Appointment[];
  nextRoutine?: RoutineItem;
}

export function todayView(p: Profile, now: Date): TodayView {
  const l = localParts(now, p.timezone);
  const nextRoutine = [...p.routine]
    .sort((a, b) => toMinutes(a.time) - toMinutes(b.time))
    .find((r) => toMinutes(r.time) > l.minutes);
  return {
    date: l.date, weekday: l.weekday, time: l.time, minutes: l.minutes,
    partOfDay: partOfDay(l.minutes),
    appointments: appointmentsOn(p, l.date, l.weekday),
    nextRoutine,
  };
}

const words = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export function matchesAppointment(a: Appointment, query: string): boolean {
  const q = new Set(words(query));
  if (q.size === 0) return false;
  return [a.name, ...a.aliases].some((n) => {
    const w = words(n);
    return w.length > 0 && w.every((x) => q.has(x));
  });
}

export interface NextAppointment { appointment: Appointment; date: string; weekday: Weekday; daysAway: number }

export function nextAppointment(p: Profile, now: Date, nameQuery?: string): NextAppointment | null {
  const l = localParts(now, p.timezone);
  const candidates = (nameQuery?.trim() ? p.appointments.filter((a) => matchesAppointment(a, nameQuery)) : p.appointments)
    .slice()
    .sort(byStart);
  for (let d = 0; d <= 14; d++) {
    const day = addDays(l.date, d);
    for (const a of candidates) {
      if (!occursOn(a, day.date, day.weekday)) continue;
      if (d === 0 && toMinutes(a.end) <= l.minutes) continue;
      return { appointment: a, date: day.date, weekday: day.weekday, daysAway: d };
    }
  }
  return null;
}
