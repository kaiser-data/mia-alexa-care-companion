import { localParts, toMinutes } from "./clock";
import { appointmentsOn } from "./today";
import type { CareEvent, HHMM, Profile } from "./types";

export type DoseState = "taken" | "due" | "upcoming" | "at_appointment";

export interface DoseStatus {
  medicationId: string;
  name: string;
  description: string;
  time: HHMM;
  state: DoseState;
  takenAt?: HHMM;
  appointmentName?: string;
}

export const DUE_WINDOW_MINUTES = 30;

export function doseStatuses(p: Profile, events: CareEvent[], now: Date): DoseStatus[] {
  const l = localParts(now, p.timezone);
  const todays = appointmentsOn(p, l.date, l.weekday);
  const out: DoseStatus[] = [];
  for (const m of p.medications) {
    if (m.weekdays && !m.weekdays.includes(l.weekday)) continue;
    for (const time of m.times) {
      const base = { medicationId: m.id, name: m.name, description: m.description, time };
      const taken = events.find((e) =>
        e.type === "med_confirmed" && e.detail?.medicationId === m.id && e.detail?.doseTime === time &&
        localParts(new Date(e.at), p.timezone).date === l.date);
      if (taken) {
        out.push({ ...base, state: "taken", takenAt: localParts(new Date(taken.at), p.timezone).time });
        continue;
      }
      const appt = m.takenAtAppointmentId
        ? todays.find((a) => a.id === m.takenAtAppointmentId &&
            toMinutes(a.start) <= toMinutes(time) && toMinutes(time) <= toMinutes(a.end))
        : undefined;
      if (appt) {
        out.push({ ...base, state: "at_appointment", appointmentName: appt.name });
        continue;
      }
      out.push({ ...base, state: l.minutes >= toMinutes(time) - DUE_WINDOW_MINUTES ? "due" : "upcoming" });
    }
  }
  return out.sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
}
