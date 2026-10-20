import { describe, expect, it } from "vitest";
import { rose, roseDe } from "@mia/shared";
import { at } from "@mia/shared/testing";
import { connect } from "./helpers";

describe("play_music", () => {
  it("plays her favourite music and logs it", async () => {
    const m = await connect(at("2026-10-14T16:31:00"));
    const r = await m.call("play_music");
    expect(r.say).toEqual(["Here is some Ella Fitzgerald."]);
    expect(r.facts).toEqual({ action: "play_music", artist: "Ella Fitzgerald" });
    const events = await m.store.eventsSince("rose", "2026-10-01T00:00:00Z");
    expect(events.at(-1)).toMatchObject({ type: "music_played", detail: { artist: "Ella Fitzgerald" } });
  });
  it("German", async () => {
    const r = await (await connect(at("2026-10-14T16:31:00"), roseDe())).call("play_music");
    expect(r.say).toEqual(["Hier ist etwas von Ella Fitzgerald."]);
  });
  it("no favourite music: does not guess, asks the carer", async () => {
    const m = await connect(at("2026-10-14T16:31:00"), { ...rose(), favouriteMusic: undefined });
    const r = await m.call("play_music");
    expect(r.say).toEqual(["I don't know that. I'll ask Tom."]);
    expect(r.facts).toEqual({ action: null });
    const events = await m.store.eventsSince("rose", "2026-10-01T00:00:00Z");
    expect(events.at(-1)).toMatchObject({ type: "unknown_question", detail: { topic: "music" } });
  });
});
