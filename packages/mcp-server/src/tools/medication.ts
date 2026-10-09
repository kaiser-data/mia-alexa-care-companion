import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { doseStatuses, joinList, templates, timeWords, type DoseStatus, type Profile } from "@mia/shared";
import { logEvent, OUTPUT_SHAPE, run, type MiaResult, type ToolContext } from "./runtime";

const names = (doses: DoseStatus[], p: Profile) => joinList([...new Set(doses.map((d) => d.name))], p.locale);

function split(s: DoseStatus[]) {
  return {
    due: s.filter((d) => d.state === "due"),
    taken: s.filter((d) => d.state === "taken"),
    upcoming: s.filter((d) => d.state === "upcoming"),
    atAppointment: s.filter((d) => d.state === "at_appointment"),
    unsure: s.filter((d) => d.state === "unsure"),
  };
}

const facts = (s: DoseStatus[]) => ({ doses: s.map(({ medicationId, name, time, state, takenAt }) => ({ medicationId, name, time, state, takenAt: takenAt ?? null })) });

async function flagUnsure(ctx: ToolContext, doses: DoseStatus[], extra?: Record<string, string>) {
  for (const d of doses) {
    await logEvent(ctx, "med_unsure", { medicationId: d.medicationId, doseTime: d.time, ...extra });
  }
}

export function registerMedicationTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool("get_medication_status", {
    title: "Did I take my pills",
    description:
      "Use whenever she asks about her pills or medication: whether she took them, which ones, or when the next ones are. " +
      "Answers only from the family's plan and the log — never give medical advice. " +
      "Examples: 'Did I take my pills?', 'Which pill now?', 'Habe ich meine Tabletten genommen?'.",
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false },
  }, async () => run(ctx, async (p, events): Promise<MiaResult> => {
    const T = templates(p.locale);
    const s = doseStatuses(p, events, ctx.now());
    const { due, taken, upcoming, atAppointment, unsure } = split(s);
    await logEvent(ctx, "med_asked");
    let say: string[];
    if (due.length) {
      await flagUnsure(ctx, unsure);
      say = [T.notYet(), T.medDue(names(due, p)), T.medIs(joinList(due.map((d) => d.description), p.locale))];
    } else if (unsure.length) {
      await flagUnsure(ctx, unsure);
      // Name only the earliest unsure dose: two names make the sentence too long to follow. The carer is told about all of them.
      say = [T.medUnsure(names(unsure.slice(0, 1), p)), T.askCarerFirst(p.carerName)];
    } else if (taken.length) {
      const last = taken.at(-1)!;
      say = [
        T.medTaken(last.name, timeWords(last.takenAt!, p.locale)),
        upcoming[0] ? T.medNextAt(timeWords(upcoming[0].time, p.locale, { withPart: true })) : T.medNoneToday(),
      ];
    } else if (upcoming[0]) {
      say = [T.medNextAt(timeWords(upcoming[0].time, p.locale, { withPart: true }))];
    } else if (atAppointment[0]) {
      say = [T.medAtAppt(atAppointment[0].name, atAppointment[0].appointmentName!)];
    } else {
      say = [T.medNoneToday()];
    }
    return { facts: facts(s), say, verbatim: true };
  }));

  server.registerTool("confirm_medication", {
    title: "I took my pills",
    description:
      "Use when she says she has taken her pills or medication. Records the doses that are due now. " +
      "If they were already taken, it kindly tells her so to prevent a double dose. " +
      "Examples: 'I took my pills.', 'Done, I had them.', 'Ich habe meine Tabletten genommen.'.",
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async () => run(ctx, async (p, events): Promise<MiaResult> => {
    const T = templates(p.locale);
    const s = doseStatuses(p, events, ctx.now());
    const { due, taken, upcoming, unsure } = split(s);
    // A self-report of an unsure dose is recorded: recording can only prevent a second dose.
    const toConfirm = due.length ? due : unsure;
    if (toConfirm.length) {
      for (const d of toConfirm) await logEvent(ctx, "med_confirmed", { medicationId: d.medicationId, doseTime: d.time });
      // The carer checks unsure doses; a self-report may have meant another dose.
      await flagUnsure(ctx, unsure, due.length ? undefined : { selfReported: "true" });
      return { facts: { confirmed: toConfirm.map((d) => d.medicationId) }, say: [T.medConfirmed(names(toConfirm, p))], verbatim: true };
    }
    if (taken.length) {
      const last = taken.at(-1)!;
      await logEvent(ctx, "med_duplicate_attempt", { medicationId: last.medicationId, doseTime: last.time });
      return { facts: { duplicate: true, medicationId: last.medicationId }, say: [T.medAlreadyTaken(last.name, timeWords(last.takenAt!, p.locale)), T.noMoreNow()], verbatim: true };
    }
    if (upcoming[0]) {
      await logEvent(ctx, "med_not_due_attempt", { medicationId: upcoming[0].medicationId, doseTime: upcoming[0].time });
      return { facts: { notDue: true }, say: [T.notYet(), T.medNextAt(timeWords(upcoming[0].time, p.locale, { withPart: true }))], verbatim: true };
    }
    return { facts: {}, say: [T.medNoneToday()], verbatim: true };
  }));
}
