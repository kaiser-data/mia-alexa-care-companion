import { describe, expect, it } from "vitest";
import { inMemoryMia } from "@mia/mcp-server/testing";
import { rose, roseDe, type Profile } from "@mia/shared";
import { at } from "@mia/shared/testing";
import { Brain, HISTORY_MESSAGES, NIGHT_REPEAT_MINUTES, SPEAKS_FIRST_MARKER, TURN_DEADLINE_MS } from "../src/brain";
import { LlmError } from "../src/llm";
import { connectMia } from "../src/mcp";
import { hang, respond, ScriptedLlm, text, tool } from "./fakes";

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
  it("LLM chooses the tool and a phrase; the template sentences are spoken after it", async () => {
    const s = await setup("2026-10-12T08:05:00", [tool("get_medication_status"), respond({ opener: "of_course" })]);
    const r = await s.brain.turn({ text: "Did I take my pills?", confidence: 0.92 });
    expect(r).toEqual({ sentences: ["Of course, Rose.", ...PILLS], rate: 0.9, breakMs: 700, tools: ["get_medication_status"] });
    const tools = s.llm.requests[0]!.tools;
    expect(tools.map((t) => t.name)).toContain("get_medication_status");
    expect(tools.at(-1)).toMatchObject({ name: "respond", strict: true });
    expect(s.llm.requests[0]!.system).toContain("English");
  });
  it("text the LLM writes next to its tool calls is never spoken", async () => {
    const step = { kind: "tools" as const, text: "You should take your pills now, dear.", calls: [{ id: "r", name: "respond", input: { opener: "none", feeling: "none", question: "none", closing: "none" } }] };
    const s = await setup("2026-10-12T08:05:00", [tool("get_medication_status"), step]);
    expect((await s.brain.turn({ text: "pills?" })).sentences).toEqual(PILLS);
  });
  it("'Yes, take it now.' from the LLM is ignored: nothing to say → offer a call", async () => {
    const step = { kind: "tools" as const, text: "Yes, take it now.", calls: [{ id: "r", name: "respond", input: {} }] };
    const s = await setup("2026-10-12T08:05:00", [step]);
    const r = await s.brain.turn({ text: "Should I take it now?" });
    expect(r).toMatchObject({ sentences: ["Shall I ask Tom to call you?"], tools: [] });
  });
  it("plain LLM text without respond is ignored too", async () => {
    for (const t of ["Yes, you took them at eight. You can relax.", "It's Tuesday today."]) {
      const s = await setup("2026-10-12T08:05:00", [text(t)]);
      expect((await s.brain.turn({ text: "Did I take my pills?" })).sentences).toEqual(["Shall I ask Tom to call you?"]);
    }
    const de = await setup("2026-10-12T08:05:00", [text("Du hast deine Tabletten schon genommen.")], roseDe());
    expect((await de.brain.turn({ text: "Habe ich meine Tabletten genommen?" })).sentences).toEqual(["Soll ich Tom um einen Anruf bitten?"]);
  });
  it("tool results go back to the LLM with say, facts and guidance", async () => {
    const s = await setup("2026-10-12T08:05:00", [tool("get_today"), respond()]);
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
    const s = await setup("2026-10-12T08:05:00", [tool("get_today"), respond(), tool("repeat_last"), respond()]);
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
  it("low confidence is passed on so the LLM can pick one yes/no check", async () => {
    const s = await setup("2026-10-12T08:05:00", [respond({ question: "check_pills" })]);
    const r = await s.brain.turn({ text: "pils", confidence: 0.45 });
    expect(r).toMatchObject({ sentences: ["Do you mean your pills?"], tools: [] });
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
    const s = await setup("2026-10-14T16:31:00", [tool("play_music"), respond()]);
    const r = await s.brain.turn({ text: "Yes please" });
    expect(r.sentences).toEqual(["Here is some Ella Fitzgerald."]);
    expect(r.action).toEqual({ type: "play_music", artist: "Ella Fitzgerald" });
  });
  it("stops after four tool rounds", async () => {
    const s = await setup("2026-10-12T08:05:00", [tool("get_today"), tool("get_today"), tool("get_today"), tool("get_today")]);
    const r = await s.brain.turn({ text: "What day is it?" });
    expect(s.llm.requests).toHaveLength(4);
    expect(r.sentences).toEqual(["Today is Monday, October 12.", "You leave for Maple Grove Day Club at twenty to ten.", "Today is Monday."]);
  });
  it("keeps only the last messages of the conversation", async () => {
    const steps = Array.from({ length: 10 }, () => respond({ feeling: "im_glad" }));
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
  it("'Pardon?' repeats what Mia really said last, not the last tool answer", async () => {
    const s = await setup("2026-10-12T08:05:00", [tool("get_medication_status"), respond(), respond({ feeling: "sounds_lovely" }), tool("repeat_last"), respond()]);
    await s.brain.turn({ text: "Did I take my pills?" });
    s.setNow("2026-10-12T11:00:00");
    expect((await s.brain.turn({ text: "Nice day" })).sentences).toEqual(["That sounds lovely."]);
    const again = await s.brain.turn({ text: "Pardon?" });
    expect(again.sentences).toEqual(["That sounds lovely."]);
    expect(again.rate).toBeCloseTo(0.81);
  });
  it("after two misses, 'yes' reaches the LLM with the call offer in history", async () => {
    const s = await setup("2026-10-12T08:05:00", [respond()]);
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
    const s = await setup("2026-10-13T03:10:00", [tool("request_call"), respond()]);
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
    // The pending request is aborted, not left running.
    expect(s.llm.signals[0]?.aborted).toBe(true);
  });
  it("an LlmError (cut off, refused) after a tool answered: the tool answer is still spoken", async () => {
    const s = await setup("2026-10-12T08:05:00", [tool("get_medication_status"), new LlmError("LLM stopped: max_tokens")]);
    expect((await s.brain.turn({ text: "Did I take my pills?" })).sentences).toEqual(PILLS);
    const none = await setup("2026-10-12T08:05:00", [new LlmError("LLM stopped: refusal")]);
    expect((await none.brain.turn({ text: "Hello" })).sentences).toEqual(["I can't check right now.", "Tom can help."]);
  });
  it("the raw assistant content goes back unchanged within the turn, not into the history", async () => {
    const raw = [{ type: "thinking", thinking: "pills", signature: "sig" }, { type: "tool_use", id: "t1", name: "get_medication_status", input: {} }];
    const step = { kind: "tools" as const, text: "", calls: [{ id: "t1", name: "get_medication_status", input: {} }], raw };
    const s = await setup("2026-10-12T08:05:00", [step, respond(), respond()]);
    await s.brain.turn({ text: "Did I take my pills?" });
    expect(s.llm.requests[1]!.messages.at(-2)).toMatchObject({ role: "assistant", raw });
    await s.brain.turn({ text: "Thanks" });
    expect(s.llm.requests[2]!.messages.some((m) => m.role === "assistant" && "raw" in m)).toBe(false);
  });
  it("a tool error goes back to the LLM so it can recover", async () => {
    const s = await setup("2026-10-12T11:00:00", [tool("no_such_tool"), respond({ question: "offer_call" })]);
    expect((await s.brain.turn({ text: "Do the thing" })).sentences).toEqual(["Shall I ask Tom to call you?"]);
    const results = s.llm.requests[1]!.messages.at(-1) as { role: string; results: { content: string }[] };
    expect(results.role).toBe("tool_results");
    expect(JSON.parse(results.results[0]!.content)).toHaveProperty("error");
  });
  it("tool sentences are never cut: over four, only they are spoken", async () => {
    const both = { kind: "tools" as const, text: "", calls: [{ id: "a", name: "get_today", input: {} }, { id: "b", name: "get_medication_status", input: {} }] };
    const s = await setup("2026-10-12T08:05:00", [both, respond({ opener: "of_course", question: "anything_else" })]);
    const r = await s.brain.turn({ text: "Tell me everything" });
    expect(r.sentences).toHaveLength(6);
    expect(r.sentences[0]).toBe("Today is Monday, October 12.");
    expect(r.sentences.at(-1)).toBe(PILLS.at(-1));
  });
});

describe("Claude picks, doesn't write", () => {
  const MON = "2026-10-12T08:05:00";
  it("'Where is Frank?': the people tool, then the call offer", async () => {
    const s = await setup(MON, [tool("who_is", { name: "Frank" }), respond({ question: "offer_call" })]);
    expect((await s.brain.turn({ text: "Where is Frank?" })).sentences)
      .toEqual(["Frank is your husband.", "Frank loved you very much.", "Shall I ask Tom to call you?"]);
  });
  it("'I had a lovely walk with Tom': a feeling and a question, no fact", async () => {
    const s = await setup(MON, [respond({ feeling: "sounds_lovely", question: "anything_else" })]);
    expect(await s.brain.turn({ text: "I had a lovely walk with Tom" }))
      .toMatchObject({ sentences: ["That sounds lovely.", "Can I help with anything else?"], tools: [] });
  });
  it("goodbye in the evening", async () => {
    const s = await setup("2026-10-12T19:30:00", [respond({ closing: "lovely_evening" })]);
    expect((await s.brain.turn({ text: "Goodbye" })).sentences).toEqual(["Have a lovely evening, Rose."]);
  });
  it("an unknown id is dropped", async () => {
    const s = await setup(MON, [respond({ opener: "nope", question: "offer_call" })]);
    expect((await s.brain.turn({ text: "Hello" })).sentences).toEqual(["Shall I ask Tom to call you?"]);
  });
  it("an id from the wrong slot is dropped", async () => {
    const s = await setup(MON, [respond({ opener: "offer_call", feeling: "sleep_well" })]);
    expect((await s.brain.turn({ text: "Hello" })).sentences).toEqual(["Shall I ask Tom to call you?"]);
  });
  it("feeling wins over opener; closing is dropped when there is a question", async () => {
    const s = await setup(MON, [respond({ opener: "hello", feeling: "im_glad", question: "anything_else", closing: "lovely_day" })]);
    expect((await s.brain.turn({ text: "I'm fine" })).sentences).toEqual(["I'm glad.", "Can I help with anything else?"]);
  });
  it("four at most: the lead is dropped first", async () => {
    const s = await setup(MON, [tool("get_today"), respond({ opener: "of_course", question: "anything_else" })]);
    expect((await s.brain.turn({ text: "What day is it?" })).sentences).toEqual([
      "Today is Monday, October 12.", "You leave for Maple Grove Day Club at twenty to ten.", "Today is Monday.", "Can I help with anything else?",
    ]);
  });
  it("German: phrases in German, the cap respected", async () => {
    const DE_PILLS = ["Noch nicht.", "Jetzt ist Zeit für deine Morgentabletten.", "Das ist die kleine weiße und die runde rosa Tablette."];
    const s = await setup(MON, [
      tool("get_medication_status"), respond({ opener: "of_course" }),
      tool("get_medication_status"), respond({ opener: "of_course", question: "anything_else" }),
    ], roseDe());
    expect((await s.brain.turn({ text: "Habe ich meine Tabletten genommen?" })).sentences).toEqual(["Natürlich, Rose.", ...DE_PILLS]);
    // Three pill sentences + opener + question would be five: the opener is dropped first.
    expect((await s.brain.turn({ text: "Und jetzt?" })).sentences).toEqual([...DE_PILLS, "Kann ich sonst noch helfen?"]);
  });
  it("too many pills alerts Tom at once, without the LLM", async () => {
    const s = await setup(MON, []);
    const r = await s.brain.turn({ text: "I took too many pills" });
    expect(r.tools).toEqual(["report_problem"]);
    expect(s.llm.requests).toHaveLength(0);
    expect(await s.store.listAlerts("rose")).toMatchObject([{ severity: "high" }]);
  });
});

describe("chat is a pick too: no LLM text is ever spoken", () => {
  const WED = "2026-10-14T15:00:00";
  const THU = "2026-10-15T15:00:00";
  const TOPIC = "You grew up in Dayton, the youngest of four sisters.";
  it("chat_about_life speaks the day's topic and asks if she remembers", async () => {
    const s = await setup(WED, [tool("chat_about_life"), respond()]);
    const r = await s.brain.turn({ text: "Talk to me" });
    expect(r.tools).toEqual(["chat_about_life"]);
    expect(r.sentences).toEqual([TOPIC, "Do you remember that?"]);
  });
  it("German: the topic from her German life story", async () => {
    const s = await setup(THU, [tool("chat_about_life"), respond()], roseDe());
    expect((await s.brain.turn({ text: "Mir ist langweilig." })).sentences)
      .toEqual(["Du liebst deinen Rosengarten, besonders die gelbe Kletterrose.", "Erinnerst du dich daran?"]);
  });
  it("a respond input with an extra chat string never reaches the sentences", async () => {
    const chat = "Frank is waiting for you at home.";
    const s = await setup(WED, [tool("chat_about_life"), respond({ chat, question: "offer_call" }), respond({ chat, feeling: "sounds_lovely" })]);
    const first = await s.brain.turn({ text: "I'm lonely" });
    expect(first.sentences.join(" ")).not.toContain("Frank");
    expect((await s.brain.turn({ text: "Yes" })).sentences.join(" ")).not.toContain("Frank");
  });
  it("C1 probe: chat next to the pill tool cannot say 'take them now' (en + de)", async () => {
    const both = { kind: "tools" as const, text: "", calls: [{ id: "a", name: "get_medication_status", input: {} }, { id: "b", name: "chat_about_life", input: {} }] };
    for (const [profile, line] of [[rose(), "You can take them now."], [roseDe(), "Du kannst sie jetzt nehmen."]] as const) {
      const s = await setup("2026-10-12T08:30:00", [tool("confirm_medication"), respond(), both, respond({ chat: line })], profile);
      await s.brain.turn({ text: "I took them" });
      const r = await s.brain.turn({ text: "pills?" });
      expect(r.tools).toEqual(["get_medication_status", "chat_about_life"]);
      expect(r.sentences.join(" ")).not.toMatch(/take them now|sie jetzt nehmen/i);
    }
  });
  it("C1 probe: the previous-turn window is gone", async () => {
    const s = await setup("2026-10-12T08:30:00", [
      tool("confirm_medication"), respond(),
      tool("chat_about_life"), respond(),
      tool("get_medication_status"), respond({ chat: "You can take them again now." }),
    ]);
    await s.brain.turn({ text: "I took them" });
    await s.brain.turn({ text: "Talk to me" });
    const r = await s.brain.turn({ text: "pills?" });
    expect(r.sentences.join(" ")).not.toMatch(/take them/i);
  });
  it("C2 probe: invented facts in chat are never spoken", async () => {
    for (const chat of ["Frank is waiting for you at home.", "Tom is coming in 38 minutes.", "You married at nineteen."]) {
      const s = await setup(WED, [tool("chat_about_life"), respond({ chat })]);
      expect((await s.brain.turn({ text: "Talk to me" })).sentences).toEqual([TOPIC, "Do you remember that?"]);
    }
  });
  it("a chat continues with picked phrases, no tool", async () => {
    const s = await setup(WED, [tool("chat_about_life"), respond(), respond({ feeling: "sounds_lovely", question: "tell_me_more" })]);
    await s.brain.turn({ text: "Talk to me" });
    expect(await s.brain.turn({ text: "Yes, we had a big garden" }))
      .toMatchObject({ sentences: ["That sounds lovely.", "Will you tell me more about it?"], tools: [] });
  });
});

describe("'Pardon?' never repeats a filler", () => {
  it("repeats the earlier real answer, not 'I'm listening.'", async () => {
    const s = await setup("2026-10-12T11:00:00", [respond({ feeling: "sounds_lovely" }), tool("repeat_last"), respond()]);
    await s.brain.turn({ text: "Nice day" });
    expect((await s.brain.turn({ text: "" })).sentences).toEqual(["I'm listening."]);
    expect((await s.brain.turn({ text: "Pardon?" })).sentences).toEqual(["That sounds lovely."]);
  });
  it("with no earlier answer, repeat_last answers by itself", async () => {
    const s = await setup("2026-10-12T11:00:00", [tool("repeat_last"), respond()]);
    await s.brain.turn({ text: "" });
    const r = await s.brain.turn({ text: "Pardon?" });
    expect(r.sentences[0]).toBe("Today is Monday, October 12.");
    expect(r.sentences).not.toContain("I'm listening.");
  });
  it("the calm fallback is not repeated either", async () => {
    const s = await setup("2026-10-12T11:00:00", [respond({ feeling: "sounds_lovely" }), new Error("down"), tool("repeat_last"), respond()]);
    await s.brain.turn({ text: "Nice day" });
    expect((await s.brain.turn({ text: "Hello" })).sentences).toEqual(["I can't check right now.", "Tom can help."]);
    expect((await s.brain.turn({ text: "Pardon?" })).sentences).toEqual(["That sounds lovely."]);
  });
});

describe("Brain.proactive", () => {
  it("after a proactive pill prompt, 'Take them now.' written by the LLM is never spoken", async () => {
    const s = await setup("2026-10-12T08:00:00", [text("Take them now.")]);
    await s.brain.proactive();
    s.setNow("2026-10-12T08:02:00");
    const r = await s.brain.turn({ text: "yes" });
    expect(r).toMatchObject({ sentences: ["Shall I ask Tom to call you?"], tools: [] });
  });
  it("Mia speaks first, and 'yes' is understood in that context", async () => {
    const s = await setup("2026-10-12T08:00:00", [tool("confirm_medication"), respond()]);
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
