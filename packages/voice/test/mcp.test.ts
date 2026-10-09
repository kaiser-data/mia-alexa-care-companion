import { describe, expect, it } from "vitest";
import { inMemoryMia } from "@mia/mcp-server/testing";
import { at } from "@mia/shared/testing";
import { connectMia } from "../src/mcp";

describe("connectMia", () => {
  it("lists Mia's tools, calls one, fetches the proactive prompt", async () => {
    const m = await inMemoryMia({ now: () => at("2026-10-12T08:05:00") });
    const mia = await connectMia({ url: m.url, token: m.token, fetch: m.fetch });
    const tools = await mia.tools();
    expect(tools.map((t) => t.name)).toContain("get_today");
    expect(tools.map((t) => t.name)).toContain("play_music");
    expect(tools.find((t) => t.name === "who_is")!.inputSchema).toMatchObject({ type: "object" });
    const today = await mia.call("get_today");
    expect(today.say[0]).toBe("Today is Monday, October 12.");
    expect(today.verbatim).toBe(true);
    expect(today.text).toBe(today.say.join(" "));
    expect((await mia.proactive())?.kind).toBe("medication");
    expect(await mia.proactive()).toBeNull();
  });
  it("a wrong token fails loudly", async () => {
    const m = await inMemoryMia({ now: () => at("2026-10-12T08:05:00") });
    await expect(connectMia({ url: m.url, token: "wrong", fetch: m.fetch })).rejects.toThrow();
  });
});
