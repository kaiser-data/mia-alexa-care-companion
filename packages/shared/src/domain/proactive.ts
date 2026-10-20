import { templates } from "../i18n/templates";
import { timeWords } from "../i18n/words";
import { localParts, toMinutes } from "./clock";
import { doseStatuses } from "./medication";
import { appointmentsOn } from "./today";
import type { CareEvent, HHMM, Profile } from "./types";

export type ProactiveKind = "medication" | "leave" | "welcome_back" | "bedtime" | "music" | "check_in";

export interface ProactivePrompt { id: string; kind: ProactiveKind; say: string[] }

export const PROMPT_WINDOW_MINUTES = 30;
export const LEAVE_LEAD_MINUTES = 15;
export const MUSIC_TIME: HHMM = "16:30";
export const NIGHT_END_MINUTES = 300;

/**
 * The one thing Mia should say first right now, if any (spec §6.1). Every prompt ends with a yes/no question.
 * The caller logs `proactive_spoken` with the prompt id, so each prompt is spoken at most once.
 */
export function proactivePrompt(p: Profile, events: CareEvent[], now: Date): ProactivePrompt | null {
  const l = localParts(now, p.timezone);
  if (l.minutes < NIGHT_END_MINUTES) return null;
  const T = templates(p.locale);
  const today = (e: CareEvent) => localParts(new Date(e.at), p.timezone).date === l.date && new Date(e.at) <= now;
  const spoken = new Set(events.filter((e) => e.type === "proactive_spoken").map((e) => e.detail?.promptId));
  const within = (start: number, length = PROMPT_WINDOW_MINUTES) => l.minutes >= start && l.minutes < start + length;
  const candidates: ProactivePrompt[] = [];

  for (const d of doseStatuses(p, events, now)) {
    if (d.state === "due" && within(toMinutes(d.time))) {
      candidates.push({ id: `med:${d.medicationId}:${d.time}:${l.date}`, kind: "medication", say: [T.medDue(d.name), T.proMedAsk(d.name)] });
    }
  }

  const appts = appointmentsOn(p, l.date, l.weekday);
  for (const a of appts) {
    const leftFor = events.filter((e) => e.type === "left_home" && e.detail?.appointmentId === a.id && today(e));
    if (a.travelMode === "alone" && a.leaveBy && !leftFor.length &&
        within(toMinutes(a.leaveBy) - LEAVE_LEAD_MINUTES, 2 * LEAVE_LEAD_MINUTES)) {
      candidates.push({ id: `leave:${a.id}:${l.date}`, kind: "leave", say: [T.leaveFor(a.name, timeWords(a.leaveBy, p.locale)), T.proPrepAsk()] });
    }
  }
  for (const a of appts) {
    const lastLeft = events.filter((e) => e.type === "left_home" && e.detail?.appointmentId === a.id && today(e)).at(-1);
    const backAfter = lastLeft && events.some((e) => e.type === "arrived_home" && today(e) && new Date(e.at) > new Date(lastLeft.at));
    if (a.expectedReturn && lastLeft && !backAfter && within(toMinutes(a.expectedReturn) + a.graceMinutes)) {
      candidates.push({ id: `back:${a.id}:${l.date}`, kind: "welcome_back", say: [T.proAreYouHome(p.preferredName)] });
    }
  }

  const bedtime = p.routine.find((r) => r.kind === "bedtime");
  if (bedtime && within(toMinutes(bedtime.time))) {
    candidates.push({ id: `bed:${l.date}`, kind: "bedtime", say: [T.proBedtime(timeWords(bedtime.time, p.locale)), T.proDoorAsk()] });
  }
  if (p.favouriteMusic && within(toMinutes(MUSIC_TIME))) {
    candidates.push({ id: `music:${l.date}`, kind: "music", say: [T.proMusicAsk(p.favouriteMusic)] });
  }
  if (p.checkInTime && within(toMinutes(p.checkInTime))) {
    candidates.push({ id: `checkin:${l.date}`, kind: "check_in", say: [T.proHello(p.preferredName), T.proChatAsk()] });
  }

  return candidates.find((c) => !spoken.has(c.id)) ?? null;
}
