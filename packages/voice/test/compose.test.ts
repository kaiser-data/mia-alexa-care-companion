import { describe, expect, it } from "vitest";
import { phraseIds } from "@mia/shared";
import { compose, MAX_SENTENCES, readRespond, RESPOND_TOOL } from "../src/compose";

const EN = { locale: "en-US" as const, name: "Rose", carer: "Tom" };
const DE = { locale: "de-DE" as const, name: "Rose", carer: "Tom" };
const TODAY = ["Today is Monday, October 12.", "You leave for Maple Grove Day Club at twenty to ten.", "Today is Monday."];

describe("RESPOND_TOOL", () => {
  it("is strict, closed, and offers only catalogue ids plus none: no free-text slot", () => {
    expect(RESPOND_TOOL.strict).toBe(true);
    const schema = RESPOND_TOOL.inputSchema as { additionalProperties: boolean; required: string[]; properties: Record<string, { enum?: string[] }> };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["opener", "feeling", "question", "closing"]);
    expect(Object.keys(schema.properties)).toEqual(["opener", "feeling", "question", "closing"]);
    for (const p of Object.values(schema.properties)) expect(p.enum).toBeDefined();
    expect(schema.properties.question!.enum).toEqual(["none", ...phraseIds("question")]);
  });
});

describe("compose", () => {
  it("lead, tool sentences, question", () => {
    expect(compose(["Not yet."], { opener: "of_course", question: "anything_else" }, EN))
      .toEqual(["Of course, Rose.", "Not yet.", "Can I help with anything else?"]);
  });
  it("splits tool entries into sentences", () => {
    expect(compose(["Yes. You took them."], null, EN)).toEqual(["Yes.", "You took them."]);
  });
  it("nothing to say → offer a call", () => {
    expect(compose([], null, EN)).toEqual(["Shall I ask Tom to call you?"]);
    expect(compose([], { opener: "none", feeling: "none", question: "none", closing: "none" }, DE)).toEqual(["Soll ich Tom um einen Anruf bitten?"]);
  });
  it("feeling wins over opener; question wins over closing", () => {
    expect(compose([], { opener: "hello", feeling: "oh_dear", question: "offer_call", closing: "sleep_well" }, EN))
      .toEqual(["Oh dear.", "Shall I ask Tom to call you?"]);
  });
  it("a closing without a question", () => {
    expect(compose([], { closing: "sleep_well" }, DE)).toEqual(["Schlaf gut, Rose."]);
  });
  it("cap: the lead goes first", () => {
    expect(compose(TODAY, { opener: "of_course", question: "anything_else" }, EN)).toEqual([...TODAY, "Can I help with anything else?"]);
  });
  it("cap: then the question; tool sentences are never cut", () => {
    const five = [...TODAY, "Not yet.", "Now it's time for your morning pills."];
    expect(compose(five, { feeling: "im_glad", question: "offer_call" }, EN)).toEqual(five);
  });
  it("readRespond treats non-strings as none", () => {
    expect(readRespond({ opener: 3, question: "offer_call", feeling: null })).toEqual({ question: "offer_call" });
  });
  it("readRespond never passes on a free-text chat string", () => {
    expect(readRespond({ question: "tell_me_more", chat: "You can take them now." })).toEqual({ question: "tell_me_more" });
  });
});
