import { describe, expect, it } from "vitest";
import { inMemoryMia } from "@mia/mcp-server/testing";
import { rose, roseDe, splitSentences, type Profile } from "@mia/shared";
import { at } from "@mia/shared/testing";
import { MAX_SENTENCES } from "../src/compose";
import { connectMia } from "../src/mcp";

/** Every Mia tool with the arguments she would typically give it. */
const CALLS: [string, Record<string, unknown>][] = [
  ["get_today", {}], ["get_medication_status", {}], ["confirm_medication", {}], ["get_next_appointment", { name: "group" }],
  ["get_preparation_steps", {}], ["get_preparation_steps", { step: 1 }], ["report_leaving", {}], ["report_home", {}],
  ["comfort_me", {}], ["request_call", {}], ["who_is", { name: "Tom" }], ["who_is", { name: "Frank" }], ["who_is", { name: "Peter" }],
  ["night_reassurance", {}], ["repeat_last", {}], ["report_problem", { what: "I fell" }], ["play_music", {}], ["chat_about_life", {}],
];
const TIMES = ["03:10", "06:00", "08:05", "09:00", "12:00", "14:25", "15:00", "20:00", "21:00"];

describe.each([["en", rose()], ["de", roseDe()]] as [string, Profile][])("every Mia tool answer fits the cap (%s)", (_, profile) => {
  it("is at most four sentences on every day of a week at several times", async () => {
    let now = at("2026-10-12T06:00:00");
    const m = await inMemoryMia({ now: () => now, profile });
    const mia = await connectMia({ url: m.url, token: m.token, fetch: m.fetch });
    const tools = new Set((await mia.tools()).map((t) => t.name));
    for (const [name] of CALLS) expect(tools.has(name), name).toBe(true);
    let checked = 0;
    for (let day = 12; day <= 18; day++) {
      for (const time of TIMES) {
        now = at(`2026-10-${day}T${time}:00`);
        for (const [name, args] of CALLS) {
          const r = await mia.call(name, args);
          if (!r.verbatim) continue;
          const n = r.say.flatMap((s) => splitSentences(s, profile.locale)).length;
          expect(n, `${name} @ ${day} ${time}: ${r.say.join(" ")}`).toBeLessThanOrEqual(MAX_SENTENCES);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  }, 60_000);
});
