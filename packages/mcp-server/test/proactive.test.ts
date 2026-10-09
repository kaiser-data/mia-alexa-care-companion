import { describe, expect, it } from "vitest";
import { at } from "@mia/shared/testing";
import { inMemoryMia } from "../src/testing";

const get = (m: Awaited<ReturnType<typeof inMemoryMia>>, auth = `Bearer ${m.token}`) =>
  m.app.request("/proactive", { headers: { authorization: auth } });

describe("GET /proactive", () => {
  it("needs the bearer token", async () => {
    const m = await inMemoryMia({ now: () => at("2026-10-12T08:05:00") });
    expect((await get(m, "Bearer wrong")).status).toBe(401);
  });
  it("returns the due prompt once, logs it, and makes it the last answer for repeat_last", async () => {
    const m = await inMemoryMia({ now: () => at("2026-10-12T08:05:00") });
    const first = (await (await get(m)).json()) as { prompt: { id: string; say: string[] } | null };
    expect(first.prompt).toMatchObject({ id: "med:morning-pills:08:00:2026-10-12", kind: "medication" });
    expect((await (await get(m)).json())).toEqual({ prompt: null });
    const events = await m.store.eventsSince("rose", "2026-10-01T00:00:00Z");
    expect(events.at(-1)).toMatchObject({ type: "proactive_spoken", detail: { promptId: "med:morning-pills:08:00:2026-10-12" } });
    expect(await m.store.getLastSay("rose")).toEqual(first.prompt!.say);
  });
  it("nothing to say at night", async () => {
    const m = await inMemoryMia({ now: () => at("2026-10-13T03:00:00") });
    expect(await (await get(m)).json()).toEqual({ prompt: null });
  });
});
