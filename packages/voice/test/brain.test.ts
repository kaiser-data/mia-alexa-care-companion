import { describe, expect, it } from "vitest";
import { inMemoryMia } from "@mia/mcp-server/testing";
import { rose, roseDe, type Profile } from "@mia/shared";
import { at } from "@mia/shared/testing";
import { Brain, HISTORY_MESSAGES, SPEAKS_FIRST_MARKER } from "../src/brain";
import { connectMia } from "../src/mcp";
import { ScriptedLlm, text, tool } from "./fakes";

async function setup(time: string, steps: ConstructorParameters<typeof ScriptedLlm>[0], profile: Profile = rose()) {
  let now = at(time);
  const m = await inMemoryMia({ now: () => now, profile });
  const mia = await connectMia({ url: m.url, token: m.token, fetch: m.fetch });
  const llm = new ScriptedLlm(steps);
  const brain = new Brain({ mia, llm, profile, now: () => now });
  return { brain, mia, llm, store: m.store, setNow: (t: string) => { now = at(t); } };
}

const PILLS = ["Not yet.", "Now it's time for your morning pills.", "That's the small white pill and the round pink one."];

describe("Brain.turn", () => {
  it("LLM chooses the tool; the template sentences are spoken after a short lead-in", async () => {
    const s = await setup("2026-10-12T08:05:00", [tool("get_medication_status"), text(`Of course. ${PILLS.join(" ")}`)]);
    const r = await s.brain.turn({ text: "Did I take my pills?", confidence: 0.92 });
    expect(r).toEqual({ sentences: ["Of course.", ...PILLS], rate: 0.9, breakMs: 700, tools: ["get_medication_status"] });
    expect(s.llm.requests[0]!.tools.map((t) => t.name)).toContain("get_medication_status");
    expect(s.llm.requests[0]!.system).toContain("English");
  });
  it("a paraphrase by the LLM is replaced by the templates", async () => {
    const s = await setup("2026-10-12T08:05:00", [tool("get_medication_status"), text("You should take your pills now, dear.")]);
    expect((await s.brain.turn({ text: "pills?" })).sentences).toEqual(PILLS);
  });
  it("tool results go back to the LLM with say, facts and guidance", async () => {
    const s = await setup("2026-10-12T08:05:00", [tool("get_today"), text("")]);
    await s.brain.turn({ text: "What day is it?" });
    const second = s.llm.requests[1]!;
    const results = second.messages.at(-1)!;
    expect(results.role).toBe("tool_results");
    const content = JSON.parse((results as { results: { content: string }[] }).results[0]!.content);
    expect(content.say[0]).toBe("Today is Monday, October 12.");
    expect(content.guidance).toContain("exactly as written");
  });
  it("distress keywords alert the carer at once, without the LLM", async () => {
    const s = await setup("2026-10-12T11:00:00", []);
    const r = await s.brain.turn({ text: "I fell in the kitchen", confidence: 0.5 });
    expect(r.sentences).toEqual(["I've let Tom know right away.", "Tom will get in touch with you."]);
    expect(r.tools).toEqual(["report_problem"]);
    expect(s.llm.requests).toHaveLength(0);
    expect(await s.store.listAlerts("rose")).toMatchObject([{ rule: "distress", severity: "high", message: 'Rose asked for help: "I fell in the kitchen".' }]);
  });
  it("German distress word", async () => {
    const s = await setup("2026-10-12T11:00:00", [], roseDe());
    expect((await s.brain.turn({ text: "Hilfe!" })).sentences).toEqual(["Ich habe Tom sofort Bescheid gegeben.", "Tom meldet sich bei dir."]);
  });
  it("at night, speech goes to night reassurance first", async () => {
    const s = await setup("2026-10-13T03:10:00", []);
    const r = await s.brain.turn({ text: "Do I have to go to work?" });
    expect(r.tools).toEqual(["night_reassurance"]);
    expect(r.sentences.at(-1)).toBe("You can go back to sleep.");
    expect(s.llm.requests).toHaveLength(0);
  });
  it("'Pardon?' repeats word for word, 10 % slower", async () => {
    const s = await setup("2026-10-12T08:05:00", [tool("get_today"), text(""), tool("repeat_last"), text("")]);
    const first = await s.brain.turn({ text: "What day is it?" });
    const again = await s.brain.turn({ text: "Pardon?" });
    expect(again.sentences).toEqual(first.sentences);
    expect(again.rate).toBeCloseTo(0.81);
  });
  it("first miss: gently listening; second miss: today and an offer to call", async () => {
    const s = await setup("2026-10-12T08:05:00", []);
    expect((await s.brain.turn({ text: "" })).sentences).toEqual(["I'm listening."]);
    const second = await s.brain.turn({ text: "mm", confidence: 0.1 });
    expect(second.tools).toEqual(["get_today"]);
    expect(second.sentences[0]).toBe("Today is Monday, October 12.");
    expect(second.sentences.at(-1)).toBe("Shall I ask Tom to call you?");
    expect(s.llm.requests).toHaveLength(0);
  });
  it("low confidence is passed on so the LLM can ask one yes/no check", async () => {
    const s = await setup("2026-10-12T08:05:00", [text("Do you mean your pills?")]);
    const r = await s.brain.turn({ text: "pils", confidence: 0.45 });
    expect(r.sentences).toEqual(["Do you mean your pills?"]);
    const user = s.llm.requests[0]!.messages.at(-1)!;
    expect(user).toEqual({ role: "user", text: "(speech recognition unsure, confidence 0.45) pils" });
  });
  it("if the LLM fails, she hears a calm fallback, not silence", async () => {
    const s = await setup("2026-10-12T08:05:00", [new Error("network down")]);
    expect((await s.brain.turn({ text: "What day is it?" })).sentences).toEqual(["I can't check right now.", "Tom can help."]);
  });
  it("an empty LLM answer without tools becomes an offer to call", async () => {
    const s = await setup("2026-10-12T08:05:00", [text("")]);
    expect((await s.brain.turn({ text: "Hmm, well" })).sentences).toEqual(["Shall I ask Tom to call you?"]);
  });
  it("music: the reply carries a play action", async () => {
    const s = await setup("2026-10-14T16:31:00", [tool("play_music"), text("")]);
    const r = await s.brain.turn({ text: "Yes please" });
    expect(r.sentences).toEqual(["Here is some Frank Sinatra."]);
    expect(r.action).toEqual({ type: "play_music", artist: "Frank Sinatra" });
  });
  it("stops after four tool rounds", async () => {
    const s = await setup("2026-10-12T08:05:00", [tool("get_today"), tool("get_today"), tool("get_today"), tool("get_today")]);
    const r = await s.brain.turn({ text: "What day is it?" });
    expect(s.llm.requests).toHaveLength(4);
    expect(r.sentences).toEqual(["Today is Monday, October 12.", "You leave for Maple Grove Day Club at twenty to ten.", "Today is Monday."]);
  });
  it("keeps only the last messages of the conversation", async () => {
    const steps = Array.from({ length: 10 }, () => text("Lovely."));
    const s = await setup("2026-10-14T15:00:00", steps);
    for (let i = 0; i < 10; i++) await s.brain.turn({ text: `turn ${i}` });
    const last = s.llm.requests.at(-1)!.messages;
    expect(last.length).toBe(HISTORY_MESSAGES + 1);
    expect(last[0]!.role).toBe("user");
  });
  it("a failing tool never leaves her in silence", async () => {
    const s = await setup("2026-10-13T03:10:00", []);
    const mia = { ...s.mia, call: async (n: string) => { if (n === "night_reassurance") throw new Error("boom"); return s.mia.call(n); } };
    const brain = new Brain({ mia, llm: s.llm, profile: rose(), now: () => at("2026-10-13T03:10:00") });
    expect((await brain.turn({ text: "hello" })).sentences).toEqual(["I can't check right now.", "Tom can help."]);
  });
});

describe("Brain.proactive", () => {
  it("Mia speaks first, and 'yes' is understood in that context", async () => {
    const s = await setup("2026-10-12T08:00:00", [tool("confirm_medication"), text("")]);
    const p = await s.brain.proactive();
    expect(p).toEqual({ sentences: ["Now it's time for your morning pills.", "Have you taken your morning pills yet?"], rate: 0.9, breakMs: 700, tools: [] });
    expect(await s.brain.proactive()).toBeNull();
    s.setNow("2026-10-12T08:02:00");
    const r = await s.brain.turn({ text: "yes" });
    expect(r.sentences).toEqual(["Thank you.", "I've noted your morning pills."]);
    const msgs = s.llm.requests[0]!.messages;
    expect(msgs[0]).toEqual({ role: "user", text: SPEAKS_FIRST_MARKER });
    expect(msgs[1]).toEqual({ role: "assistant", text: "Now it's time for your morning pills. Have you taken your morning pills yet?" });
    expect(msgs[2]).toEqual({ role: "user", text: "yes" });
  });
  it("a throwing proactive() returns null", async () => {
    const s = await setup("2026-10-12T08:00:00", []);
    const mia = { ...s.mia, proactive: async () => { throw new Error("down"); } };
    const brain = new Brain({ mia, llm: s.llm, profile: rose(), now: () => at("2026-10-12T08:00:00") });
    expect(await brain.proactive()).toBeNull();
  });
  it("nothing to say → null", async () => {
    const s = await setup("2026-10-14T11:00:00", []);
    expect(await s.brain.proactive()).toBeNull();
  });
});
