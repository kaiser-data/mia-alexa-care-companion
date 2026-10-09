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
  /** why Mia is not sure; set whenever state is "unsure" */
  unsureReason?: "appointment" | "overdue" | "early_report" | "came_home";
}

export const DUE_WINDOW_MINUTES = 30;
/** A dose not taken this long after its time is no longer safe to prompt: ask the carer. */
export const OVERDUE_MINUTES = 120;

type TimeState = "upcoming" | "due" | "unsure";

function timeState(minutes: number, time: HHMM): TimeState {
  const t = toMinutes(time);
  if (minutes < t - DUE_WINDOW_MINUTES) return "upcoming";
  return minutes < t + OVERDUE_MINUTES ? "due" : "unsure";
}

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

/** Normal evaluation of a not-taken dose by the clock, a self-report and an early return. */
function clockStatus(
  base: Pick<DoseStatus, "medicationId" | "name" | "description" | "time">,
  events: CareEvent[], todayDate: string, minutes: number, now: Date, timezone: string,
): DoseStatus {
  const early = events.some((e) => {
    if (e.type !== "med_not_due_attempt" || e.detail?.medicationId !== base.medicationId || e.detail?.doseTime !== base.time) return false;
    const at = new Date(e.at);
    const l = localParts(at, timezone);
    return l.date === todayDate && at <= now && toMinutes(base.time) - l.minutes <= OVERDUE_MINUTES;
  });
  if (early) return { ...base, state: "unsure", unsureReason: "early_report" };
  const state = timeState(minutes, base.time);
  return state === "unsure" ? { ...base, state, unsureReason: "overdue" } : { ...base, state };
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
        const left = appointmentEventBefore(events, appt.id, l.date, now, p.timezone, "left_home");
        if (left) {
          // Rule 2b: she came back before the dose time, so the group did not give it
          const cameHome = events.some((e) => {
            if (e.type !== "arrived_home") return false;
            const at = new Date(e.at);
            const lp = localParts(at, p.timezone);
            return lp.date === l.date && at > new Date(left.at) && at <= now && lp.minutes < toMinutes(time);
          });
          out.push(cameHome
            ? { ...base, state: "unsure", unsureReason: "came_home", appointmentName: appt.name }
            : { ...base, state: "at_appointment", appointmentName: appt.name });
          continue;
        }

        // Rule 3: stayed_home event exists for this appointment today, at or before now → normal evaluation
        if (appointmentEventBefore(events, appt.id, l.date, now, p.timezone, "stayed_home")) {
          out.push(clockStatus(base, events, l.date, l.minutes, now, p.timezone));
          continue;
        }

        // Rule 4: otherwise → unsure
        out.push({ ...base, state: "unsure", unsureReason: "appointment", appointmentName: appt.name });
        continue;
      }

      out.push(clockStatus(base, events, l.date, l.minutes, now, p.timezone));
    }
  }
  return out.sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
}
