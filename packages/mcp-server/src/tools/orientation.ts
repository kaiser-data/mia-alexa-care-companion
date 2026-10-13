import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  dateWords, localParts, nextAppointment, partOfDay, templates, timeWords, todayView, toMinutes, weekdayName,
  type Profile,
} from "@mia/shared";
import { appointmentLine, capText, logEvent, OUTPUT_SHAPE, run, type MiaResult, type ToolContext } from "./runtime";
import { weatherLine } from "../weather";

export async function todayResult(ctx: ToolContext, p: Profile): Promise<MiaResult> {
  const T = templates(p.locale);
  const v = todayView(p, ctx.now());
  const say = [T.todayIs(dateWords(v.date, v.weekday, p.locale))];
  const current = v.appointments.find((a) => toMinutes(a.end) > v.minutes);
  if (current) say.push(appointmentLine(current, v.minutes, p.locale));
  else if (v.nextRoutine) say.push(T.nextRoutine(v.nextRoutine.label, timeWords(v.nextRoutine.time, p.locale, { withPart: true })));
  else say.push(T.nothingToday());
  say.push(T.repeatDay(weekdayName(v.weekday, p.locale)));
  await logEvent(ctx, "orientation_asked");
  return {
    facts: { date: v.date, weekday: v.weekday, time: v.time, partOfDay: v.partOfDay, appointments: v.appointments.map((a) => a.name), nextRoutine: v.nextRoutine ?? null },
    say,
    verbatim: true,
  };
}

export function registerOrientationTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool("get_today", {
    title: "What day is it, what happens today",
    description:
      "Use whenever she asks what day or date it is, what time of day it is, what is happening today, or seems unsure about the day. " +
      "Examples: 'What day is it?', 'Is it Sunday?', 'What am I doing today?', 'Welcher Tag ist heute?', 'Was ist heute los?'.",
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false, idempotentHint: true },
  }, async () => run(ctx, (p) => todayResult(ctx, p)));

  server.registerTool("get_next_appointment", {
    title: "When is my group / next appointment",
    description:
      "Use when she asks whether an appointment is today or when it is next — especially her group. Pass her own words as 'name', in her language. " +
      "Examples: 'Is it group today?', 'When is my club?', 'Ist heute Gruppe?', 'Wann ist die Tagesgruppe?'.",
    inputSchema: { name: z.string().optional().describe("Her words for the appointment, e.g. 'group'") },
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false, idempotentHint: true },
  }, async ({ name }) => run(ctx, async (p) => {
    const T = templates(p.locale);
    const now = ctx.now();
    const n = nextAppointment(p, now, name);
    if (!n) {
      await logEvent(ctx, "unknown_question", { topic: "appointment", query: capText(name ?? "", 80) });
      return { facts: { found: false }, say: [T.dontKnow(p.carerName)], verbatim: true };
    }
    await logEvent(ctx, "orientation_asked", { appointmentId: n.appointment.id });
    const facts = { found: true, name: n.appointment.name, date: n.date, weekday: n.weekday, daysAway: n.daysAway, travelMode: n.appointment.travelMode };
    if (n.daysAway === 0) {
      const minutes = localParts(now, p.timezone).minutes;
      return { facts, say: [T.apptTodayYes(n.appointment.name), appointmentLine(n.appointment, minutes, p.locale, { named: false })], verbatim: true };
    }
    const day = weekdayName(n.weekday, p.locale);
    return { facts, say: [T.apptNotToday(n.appointment.name, day), T.onDay(day)], verbatim: true };
  }));

  server.registerTool("get_preparation_steps", {
    title: "What do I need to take",
    description:
      "Use when she asks what to bring or take for today's appointment, or says 'and then?' while getting ready. " +
      "Returns two items at a time; call again with step = facts.nextStep for more. Examples: 'What do I need?', 'Was muss ich mitnehmen?'.",
    inputSchema: { step: z.number().int().min(0).optional().describe("0 for the first items, then facts.nextStep") },
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false },
  }, async ({ step }) => run(ctx, async (p) => {
    const T = templates(p.locale);
    const n = nextAppointment(p, ctx.now());
    if (!n || n.daysAway !== 0) return { facts: { hasMore: false }, say: [T.nothingToday()], verbatim: true };
    const s = step ?? 0;
    const items = n.appointment.checklist.slice(s * 2, s * 2 + 2);
    if (!items.length) return { facts: { hasMore: false }, say: [T.thatsAll()], verbatim: true };
    const hasMore = n.appointment.checklist.length > s * 2 + 2;
    const weather = s === 0 && p.location && ctx.weather
      ? weatherLine(await ctx.weather.today(p.location.latitude, p.location.longitude, n.date).catch(() => null), p.locale)
      : null;
    return {
      facts: { appointment: n.appointment.name, items, nextStep: s + 1, hasMore, weather },
      say: weather ? [weather, T.take(items)] : [T.take(items)],
      verbatim: true,
    };
  }));

  server.registerTool("night_reassurance", {
    title: "Reassurance at night",
    description:
      "Use when she is awake at night, confused about the time, or thinks she must get up or go to work. " +
      "Examples: 'Is it morning?', 'Do I have to go to work?', 'Ist es schon Morgen?', 'Muss ich zur Arbeit?'.",
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false },
  }, async () => run(ctx, async (p) => {
    const l = localParts(ctx.now(), p.timezone);
    if (partOfDay(l.minutes) !== "night") return todayResult(ctx, p);
    const T = templates(p.locale);
    await logEvent(ctx, "night_awake");
    return { facts: { time: l.time, night: true }, say: [T.nightIs(timeWords(l.time, p.locale)), T.nightSafe()], verbatim: true };
  }));
}
