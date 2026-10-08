import { localParts, toMinutes } from "./clock";
import { appointmentsOn } from "./today";
import type { CareEvent, EventType, HHMM, Profile } from "./types";

export type DoseState = "taken" | "due" | "upcoming" | "at_appointment" | "unsure";

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

/** Event of type eventType for this appointment on today's date, at or before now */
function appointmentEventBefore(
  events: CareEvent[],
  apptId: string,
  todayDate: string,
  now: Date,
  timezone: string,
  eventType: EventType,
): CareEvent | undefined {
  return events.find((e) =>
    e.type === eventType &&
    e.detail?.appointmentId === apptId &&
    localParts(new Date(e.at), timezone).date === todayDate &&
    new Date(e.at) <= now,
  );
}

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
        // Rule 1: now before appt.start → at_appointment (still expected to go)
        if (l.minutes < toMinutes(appt.start)) {
          out.push({ ...base, state: "at_appointment", appointmentName: appt.name });
          continue;
        }

        // Rule 2: left_home event exists for this appointment today, at or before now
        if (appointmentEventBefore(events, appt.id, l.date, now, p.timezone, "left_home")) {
          out.push({ ...base, state: "at_appointment", appointmentName: appt.name });
          continue;
        }

        // Rule 3: stayed_home event exists for this appointment today, at or before now → normal evaluation
        if (appointmentEventBefore(events, appt.id, l.date, now, p.timezone, "stayed_home")) {
          out.push({ ...base, state: l.minutes >= toMinutes(time) - DUE_WINDOW_MINUTES ? "due" : "upcoming" });
          continue;
        }

        // Rule 4: otherwise → unsure
        out.push({ ...base, state: "unsure", appointmentName: appt.name });
        continue;
      }

      out.push({ ...base, state: l.minutes >= toMinutes(time) - DUE_WINDOW_MINUTES ? "due" : "upcoming" });
    }
  }
  return out.sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
}
