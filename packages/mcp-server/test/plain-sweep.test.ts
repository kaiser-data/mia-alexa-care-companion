import { describe, expect, it } from "vitest";
import { checkPlain, rose, roseDe, type Profile, proactivePrompt } from "@mia/shared";
import { at } from "@mia/shared/testing";
import { connect } from "./helpers";

const SCRIPT: [string, string, Record<string, unknown>?][] = [
  ["2026-10-12T06:00:00", "get_medication_status"],
  ["2026-10-12T06:00:00", "confirm_medication"],
  ["2026-10-12T08:05:00", "get_today"],
  ["2026-10-12T08:05:00", "get_medication_status"],
  ["2026-10-12T08:05:00", "confirm_medication"],
  ["2026-10-12T08:07:00", "confirm_medication"],
  ["2026-10-12T08:10:00", "get_next_appointment", { name: "group" }],
  ["2026-10-12T09:00:00", "get_preparation_steps"],
  ["2026-10-12T09:00:00", "get_preparation_steps", { step: 1 }],
  ["2026-10-12T09:38:00", "report_leaving"],
  ["2026-10-12T11:00:00", "get_today"],
  ["2026-10-12T14:25:00", "report_home"],
  ["2026-10-12T16:30:00", "comfort_me"],
  ["2026-10-12T16:31:00", "request_call"],
  ["2026-10-12T17:00:00", "who_is", { name: "Tom" }],
  ["2026-10-12T17:00:00", "who_is", { name: "Peter" }],
  ["2026-10-12T21:00:00", "confirm_medication"],
  ["2026-10-12T21:00:00", "get_medication_status"],
  ["2026-10-13T03:10:00", "night_reassurance"],
  ["2026-10-13T03:11:00", "repeat_last"],
  ["2026-10-14T10:00:00", "get_next_appointment", { name: "group" }],
  ["2026-10-14T15:10:00", "get_today"],
  ["2026-10-14T15:20:00", "report_problem", { what: "I fell" }],
  ["2026-10-14T16:31:00", "play_music"],
  ["2026-10-14T20:00:00", "get_medication_status"],
  ["2026-10-14T21:00:00", "confirm_medication"],
  ["2026-10-15T14:45:00", "get_medication_status"],
];

describe.each([["en", rose()], ["de", roseDe()]] as [string, Profile][])("plain-language sweep (%s)", (_, profile) => {
  it("every spoken answer in a full day passes the plain-language rules", async () => {
    const m = await connect(at(SCRIPT[0]![0]), profile);
    for (const [time, tool, args] of SCRIPT) {
      m.setNow(at(time));
      const r = await m.call(tool, args ?? {});
      if (!r.verbatim) continue;
      expect(r.say.length, `${tool} @ ${time}`).toBeGreaterThan(0);
      expect(checkPlain(r.say.join(" "), profile.locale), `${tool} @ ${time}: ${r.say.join(" ")}`).toMatchObject({ ok: true });
    }
  });

  it("every proactive prompt of a full week passes the plain-language rules", () => {
    const seen = new Set<string>();
    for (let day = 12; day <= 18; day++) {
      for (let minutes = 0; minutes < 24 * 60; minutes += 5) {
        const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
        const mm = String(minutes % 60).padStart(2, "0");
        const prompt = proactivePrompt(profile, [], at(`2026-10-${day}T${hh}:${mm}:00`));
        if (!prompt || seen.has(prompt.kind)) continue;
        seen.add(prompt.kind);
        expect(checkPlain(prompt.say.join(" "), profile.locale), prompt.say.join(" ")).toMatchObject({ ok: true });
        expect(prompt.say.at(-1)!.endsWith("?"), prompt.id).toBe(true);
      }
    }
    expect([...seen].sort()).toEqual(["bedtime", "check_in", "leave", "medication", "music"]);
  });
});
