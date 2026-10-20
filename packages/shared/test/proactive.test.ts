import { describe, expect, it } from "vitest";
import { proactivePrompt } from "../src/domain/proactive";
import type { CareEvent, EventType } from "../src/domain/types";
import { checkPlain } from "../src/i18n/plain";
import { rose, roseDe } from "../src/seed/rose";
import { at } from "../src/testing";

const ev = (type: EventType, iso: string, detail?: Record<string, string>): CareEvent =>
  ({ profileId: "rose", type, at: iso, ...(detail ? { detail } : {}) });
const spoken = (promptId: string, iso: string) => ev("proactive_spoken", iso, { promptId });
const left = (iso: string) => ev("left_home", iso, { appointmentId: "maple-grove" });

describe("proactivePrompt", () => {
  it("Mon 08:00: morning pills, ends with a yes/no question", () => {
    expect(proactivePrompt(rose(), [], at("2026-10-12T08:00:00"))).toEqual({
      id: "med:morning-pills:08:00:2026-10-12", kind: "medication",
      say: ["Now it's time for your morning pills.", "Have you taken your morning pills yet?"],
    });
  });
  it("German", () => {
    expect(proactivePrompt(roseDe(), [], at("2026-10-12T08:00:00"))?.say).toEqual([
      "Jetzt ist Zeit für deine Morgentabletten.", "Hast du deine Morgentabletten schon genommen?",
    ]);
  });
  it("a prompt is spoken only once", () => {
    const events = [spoken("med:morning-pills:08:00:2026-10-12", "2026-10-12T12:00:00Z")];
    expect(proactivePrompt(rose(), events, at("2026-10-12T08:10:00"))).toBeNull();
  });
  it("no pill prompt when the dose is already taken", () => {
    const events = [ev("med_confirmed", "2026-10-12T12:01:00Z", { medicationId: "morning-pills", doseTime: "08:00" })];
    expect(proactivePrompt(rose(), events, at("2026-10-12T08:05:00"))).toBeNull();
  });
  it("no pill prompt before the dose time, even though the dose is already due", () => {
    expect(proactivePrompt(rose(), [], at("2026-10-12T07:45:00"))).toBeNull();
  });
  it("Mon 09:30: time to leave for the group, offer to say what to take", () => {
    expect(proactivePrompt(rose(), [], at("2026-10-12T09:30:00"))).toEqual({
      id: "leave:maple-grove:2026-10-12", kind: "leave",
      say: ["You leave for Maple Grove Day Club at twenty to ten.", "Shall I tell you what to take?"],
    });
  });
  it("no leave prompt once she has left", () => {
    expect(proactivePrompt(rose(), [left("2026-10-12T13:20:00Z")], at("2026-10-12T09:30:00"))).toBeNull();
  });
  it("Mon 15:00: not back after the group → are you back home?", () => {
    expect(proactivePrompt(rose(), [left("2026-10-12T13:38:00Z")], at("2026-10-12T15:00:00"))).toEqual({
      id: "back:maple-grove:2026-10-12", kind: "welcome_back", say: ["Are you back home, Rose?"],
    });
  });
  it("no welcome-back prompt when she is home", () => {
    const events = [left("2026-10-12T13:38:00Z"), ev("arrived_home", "2026-10-12T18:25:00Z")];
    expect(proactivePrompt(rose(), events, at("2026-10-12T15:00:00"))).toBeNull();
  });
  it("Wed 15:30: gentle check-in", () => {
    expect(proactivePrompt(rose(), [], at("2026-10-14T15:30:00"))?.say).toEqual(["Hello, Rose.", "Shall we have a little chat?"]);
  });
  it("Wed 16:30: favourite music offer", () => {
    expect(proactivePrompt(rose(), [], at("2026-10-14T16:30:00"))).toEqual({
      id: "music:2026-10-14", kind: "music", say: ["Shall I play some Ella Fitzgerald?"],
    });
  });
  it("Wed 20:00: evening pill only (overdue doses are not prompted)", () => {
    expect(proactivePrompt(rose(), [], at("2026-10-14T20:00:00"))?.id).toBe("med:evening-pill:20:00:2026-10-14");
  });
  it("Wed 21:30: bedtime and the front door", () => {
    expect(proactivePrompt(rose(), [], at("2026-10-14T21:30:00"))?.say).toEqual([
      "It's half past nine. Time to get ready for bed.", "Is the front door locked?",
    ]);
  });
  it("never at night", () => {
    expect(proactivePrompt(rose(), [], at("2026-10-14T03:00:00"))).toBeNull();
  });
  it("without music or check-in time in the profile, those prompts do not exist", () => {
    const p = { ...rose(), favouriteMusic: undefined, checkInTime: undefined };
    expect(proactivePrompt(p, [], at("2026-10-14T15:30:00"))).toBeNull();
    expect(proactivePrompt(p, [], at("2026-10-14T16:30:00"))).toBeNull();
  });
  it.each(["2026-10-12T08:00:00", "2026-10-12T09:30:00", "2026-10-14T15:30:00", "2026-10-14T16:30:00", "2026-10-14T21:30:00"])(
    "every prompt at %s is plain language in en and de", (time) => {
      for (const p of [rose(), roseDe()]) {
        const prompt = proactivePrompt(p, [], at(time));
        expect(prompt).not.toBeNull();
        expect(checkPlain(prompt!.say.join(" "), p.locale), prompt!.say.join(" ")).toMatchObject({ ok: true });
        expect(prompt!.say.at(-1)!.endsWith("?")).toBe(true);
      }
    });
});
