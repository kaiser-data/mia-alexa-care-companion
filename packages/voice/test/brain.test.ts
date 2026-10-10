import { describe, expect, it } from "vitest";
import { inMemoryMia } from "@mia/mcp-server/testing";
import { rose, roseDe, type Profile } from "@mia/shared";
import { at } from "@mia/shared/testing";
import { Brain, HISTORY_MESSAGES, NIGHT_REPEAT_MINUTES, SPEAKS_FIRST_MARKER, TURN_DEADLINE_MS } from "../src/brain";
import { connectMia } from "../src/mcp";
import { hang, ScriptedLlm, text, tool } from "./fakes";

async function setup(time: string, steps: ConstructorParameters<typeof ScriptedLlm>[0], profile: Profile = rose(), turnDeadlineMs?: number) {
  let now = at(time);
  const m = await inMemoryMia({ now: () => now, profile });
  const mia = await connectMia({ url: m.url, token: m.token, fetch: m.fetch });
  const llm = new ScriptedLlm(steps);
  const brain = new Brain({ mia, llm, profile, now: () => now, ...(turnDeadlineMs ? { turnDeadlineMs } : {}) });
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
  it("a quiet, badly heard 'I fell' still alerts Tom", async () => {
    for (const [t, c] of [["I fell", 0.2], ["help", 0.25]] as const) {
      const s = await setup("2026-10-12T11:00:00", []);
      const r = await s.brain.turn({ text: t, confidence: c });
      expect(r.tools).toEqual(["report_problem"]);
      expect(r.sentences).toEqual(["I've let Tom know right away.", "Tom will get in touch with you."]);
      expect(await s.store.listAlerts("rose")).toMatchObject([{ severity: "high" }]);
    }
  });
  it("an LLM fact about pills without a tool is replaced by the medication status", async () => {
    const s = await setup("2026-10-12T08:05:00", [text("Yes, you took them at eight. You can relax.")]);
    const r = await s.brain.turn({ text: "Did I take my pills?" });
    expect(r.sentences).toEqual(PILLS);
    expect(r.tools).toEqual(["get_medication_status"]);
  });
  it("'may' and 'march' are ordinary words, not dates", async () => {
    const s = await setup("2026-10-14T15:00:00", [text("You may rest a little.")]);
    expect((await s.brain.turn({ text: "I'm tired" })).sentences).toEqual(["You may rest a little."]);
  });
  it("an LLM date without a tool is replaced by today", async () => {
    const s = await setup("2026-10-12T08:05:00", [text("It's Tuesday today.")]);
    const r = await s.brain.turn({ text: "What day is it?" });
    expect(r.tools).toEqual(["get_today"]);
    expect(r.sentences[0]).toBe("Today is Monday, October 12.");
  });
  it("German: an LLM statement about pills without a tool is replaced too", async () => {
    const s = await setup("2026-10-12T08:05:00", [text("Du hast deine Tabletten schon genommen.")], roseDe());
    expect((await s.brain.turn({ text: "Habe ich meine Tabletten genommen?" })).tools).toEqual(["get_medication_status"]);
  });
  it("a checking question about pills stays", async () => {
    const s = await setup("2026-10-12T08:05:00", [text("Do you mean your pills?")]);
    expect(await s.brain.turn({ text: "pils" })).toMatchObject({ sentences: ["Do you mean your pills?"], tools: [] });
  });
  it("'Pardon?' repeats what Mia really said last, not the last tool answer", async () => {
    const s = await setup("2026-10-12T08:05:00", [tool("get_medication_status"), text(""), text("Lovely weather."), tool("repeat_last"), text("")]);
    await s.brain.turn({ text: "Did I take my pills?" });
    s.setNow("2026-10-12T11:00:00");
    expect((await s.brain.turn({ text: "Nice day" })).sentences).toEqual(["Lovely weather."]);
    const again = await s.brain.turn({ text: "Pardon?" });
    expect(again.sentences).toEqual(["Lovely weather."]);
    expect(again.rate).toBeCloseTo(0.81);
  });
  it("after two misses, 'yes' reaches the LLM with the call offer in history", async () => {
    const s = await setup("2026-10-12T08:05:00", [text("")]);
    await s.brain.turn({ text: "" });
    await s.brain.turn({ text: "" });
    await s.brain.turn({ text: "yes" });
    const assistant = s.llm.requests[0]!.messages.filter((m) => m.role === "assistant");
    expect(assistant.at(-1)!.text.endsWith("Shall I ask Tom to call you?")).toBe(true);
  });
  it("Mia speaking first resets the misses", async () => {
    const s = await setup("2026-10-12T08:00:00", []);
    await s.brain.turn({ text: "" });
    expect(await s.brain.proactive()).not.toBeNull();
    expect((await s.brain.turn({ text: "" })).sentences).toEqual(["I'm listening."]);
  });
  it("at night, reassurance first; a follow-up within ten minutes goes to the LLM", async () => {
    expect(NIGHT_REPEAT_MINUTES).toBe(10);
    const s = await setup("2026-10-13T03:10:00", [tool("request_call"), text("")]);
    expect((await s.brain.turn({ text: "Is it morning?" })).tools).toEqual(["night_reassurance"]);
    expect(s.llm.requests).toHaveLength(0);
    s.setNow("2026-10-13T03:12:00");
    const r = await s.brain.turn({ text: "Can Tom call me?" });
    expect(r.tools).toEqual(["request_call"]);
    expect(r.sentences).toEqual(["I've asked Tom to call you."]);
    s.setNow("2026-10-13T03:30:00");
    expect((await s.brain.turn({ text: "Is it morning?" })).tools).toEqual(["night_reassurance"]);
    expect(s.llm.requests).toHaveLength(2);
  });
  it("if the LLM fails after a tool answered, the tool answer is still spoken", async () => {
    const s = await setup("2026-10-12T11:00:00", [tool("report_problem", { what: "I fell" }), new Error("down")]);
    expect((await s.brain.turn({ text: "I am not well" })).sentences).toEqual(["I've let Tom know right away.", "Tom will get in touch with you."]);
  });
  it("an LLM that never answers ends in a calm fallback at the deadline", async () => {
    expect(TURN_DEADLINE_MS).toBe(10_000);
    const s = await setup("2026-10-12T11:00:00", [hang()], rose(), 50);
    expect((await s.brain.turn({ text: "What day is it?" })).sentences).toEqual(["I can't check right now.", "Tom can help."]);
  });
  it("a tool error goes back to the LLM so it can recover", async () => {
    const s = await setup("2026-10-12T11:00:00", [tool("no_such_tool"), text("Shall I ask Tom to call you?")]);
    expect((await s.brain.turn({ text: "Do the thing" })).sentences).toEqual(["Shall I ask Tom to call you?"]);
    const results = s.llm.requests[1]!.messages.at(-1) as { role: string; results: { content: string }[] };
    expect(results.role).toBe("tool_results");
    expect(JSON.parse(results.results[0]!.content)).toHaveProperty("error");
  });
  it("never more than four sentences", async () => {
    const both = { kind: "tools" as const, text: "", calls: [{ id: "a", name: "get_today", input: {} }, { id: "b", name: "get_medication_status", input: {} }] };
    const s = await setup("2026-10-12T08:05:00", [both, text("Of course.")]);
    const r = await s.brain.turn({ text: "Tell me everything" });
    expect(r.sentences).toHaveLength(4);
    expect(r.sentences[0]).toBe("Today is Monday, October 12.");
  });
});

describe("fact guard v2", () => {
  const MON = "2026-10-12T08:05:00";
  it("'Should I take it now?' is answered by the pill tool, never by the LLM", async () => {
    const s = await setup(MON, [text("Yes, take it now.")]);
    const r = await s.brain.turn({ text: "Should I take it now?" });
    expect(r.tools).toEqual(["get_medication_status"]);
    expect(r.sentences[0]).toBe("Not yet.");
  });
  it("German: 'Soll ich sie jetzt nehmen?'", async () => {
    const s = await setup(MON, [text("Ja, nimm sie jetzt.")], roseDe());
    expect((await s.brain.turn({ text: "Soll ich sie jetzt nehmen?" })).tools).toEqual(["get_medication_status"]);
  });
  it("'Have I had them?'", async () => {
    const s = await setup(MON, [text("Yes, you had them at eight.")]);
    expect((await s.brain.turn({ text: "Have I had them?" })).tools).toEqual(["get_medication_status"]);
  });
  it("a fact hidden in a question is still a fact", async () => {
    const s = await setup(MON, [text("You took your pills at 8, didn't you?")]);
    expect((await s.brain.turn({ text: "pills?" })).tools).toEqual(["get_medication_status"]);
  });
  it("a relative day and a number word are a date", async () => {
    const s = await setup("2026-10-14T15:00:00", [text("Your group is tomorrow at nine.")]);
    expect((await s.brain.turn({ text: "When is my group?" })).tools).toEqual(["get_today"]);
  });
  it("German: 'Heute kommt Tom.'", async () => {
    const s = await setup(MON, [text("Heute kommt Tom.")], roseDe());
    expect((await s.brain.turn({ text: "Kommt Tom?" })).tools).toEqual(["get_today"]);
  });
  it("a greeting is not a time of day", async () => {
    const s = await setup(MON, [text("Good morning, Rose! How are you?")]);
    expect(await s.brain.turn({ text: "Good morning" })).toMatchObject({ sentences: ["Good morning, Rose!", "How are you?"], tools: [] });
    const de = await setup(MON, [text("Guten Morgen, Rose! Wie geht es dir?")], roseDe());
    expect(await de.brain.turn({ text: "Guten Morgen" })).toMatchObject({ sentences: ["Guten Morgen, Rose!", "Wie geht es dir?"], tools: [] });
  });
  it("chatting about her life story may name years", async () => {
    const said = "You married Frank in 1966. Shall we talk about it?";
    const s = await setup(MON, [tool("chat_about_life"), text(said)]);
    const r = await s.brain.turn({ text: "Talk to me" });
    expect(r.sentences).toEqual(["You married Frank in 1966.", "Shall we talk about it?"]);
    expect(r.tools).toEqual(["chat_about_life"]);
  });
  it("small talk stays", async () => {
    const s = await setup(MON, [text("You're welcome, Rose.")]);
    expect(await s.brain.turn({ text: "Thank you" })).toMatchObject({ sentences: ["You're welcome, Rose."], tools: [] });
  });
  it("after a pill answer, 'Take it now.' goes back to the pill tool", async () => {
    const s = await setup(MON, [tool("get_medication_status"), text(""), text("Take it now.")]);
    await s.brain.turn({ text: "Did I take my pills?" });
    const r = await s.brain.turn({ text: "And now?" });
    expect(r.tools).toEqual(["get_medication_status"]);
    expect(r.sentences).toEqual(PILLS);
  });
  it("too many pills alerts Tom at once, without the LLM", async () => {
    const s = await setup(MON, []);
    const r = await s.brain.turn({ text: "I took too many pills" });
    expect(r.tools).toEqual(["report_problem"]);
    expect(s.llm.requests).toHaveLength(0);
    expect(await s.store.listAlerts("rose")).toMatchObject([{ severity: "high" }]);
  });
  it("the guard keeps a call offer that states no fact", async () => {
    const s = await setup(MON, [text("Oh dear. Shall I ask Tom to call you?")]);
    const r = await s.brain.turn({ text: "I feel odd about my pills" });
    expect(r.tools).toEqual(["get_medication_status"]);
    expect(r.sentences).toEqual([...PILLS, "Shall I ask Tom to call you?"]);
  });
});

describe("'Pardon?' never repeats a filler", () => {
  it("repeats the earlier real answer, not 'I'm listening.'", async () => {
    const s = await setup("2026-10-12T11:00:00", [text("Lovely weather."), tool("repeat_last"), text("")]);
    await s.brain.turn({ text: "Nice day" });
    expect((await s.brain.turn({ text: "" })).sentences).toEqual(["I'm listening."]);
    expect((await s.brain.turn({ text: "Pardon?" })).sentences).toEqual(["Lovely weather."]);
  });
  it("with no earlier answer, repeat_last answers by itself", async () => {
    const s = await setup("2026-10-12T11:00:00", [tool("repeat_last"), text("")]);
    await s.brain.turn({ text: "" });
    const r = await s.brain.turn({ text: "Pardon?" });
    expect(r.sentences[0]).toBe("Today is Monday, October 12.");
    expect(r.sentences).not.toContain("I'm listening.");
  });
  it("the calm fallback is not repeated either", async () => {
    const s = await setup("2026-10-12T11:00:00", [text("Lovely weather."), new Error("down"), tool("repeat_last"), text("")]);
    await s.brain.turn({ text: "Nice day" });
    expect((await s.brain.turn({ text: "Hello" })).sentences).toEqual(["I can't check right now.", "Tom can help."]);
    expect((await s.brain.turn({ text: "Pardon?" })).sentences).toEqual(["Lovely weather."]);
  });
});

describe("Brain.proactive", () => {
  it("after a proactive pill prompt, 'take them' without the pill tool is replaced", async () => {
    const s = await setup("2026-10-12T08:00:00", [text("Take them now.")]);
    await s.brain.proactive();
    s.setNow("2026-10-12T08:02:00");
    const r = await s.brain.turn({ text: "yes" });
    expect(r.tools).toEqual(["get_medication_status"]);
    expect(r.sentences[0]).toBe("Not yet.");
  });
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
