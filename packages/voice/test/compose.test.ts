import { describe, expect, it } from "vitest";
import { phraseIds, rose, roseDe } from "@mia/shared";
import { checkChat, compose, MAX_SENTENCES, readRespond, RESPOND_TOOL, type ChatFacts } from "../src/compose";

const EN = { locale: "en-US" as const, name: "Rose", carer: "Tom" };
const DE = { locale: "de-DE" as const, name: "Rose", carer: "Tom" };
const FACTS: ChatFacts = { topics: rose().lifeStory, suggestedTopic: rose().lifeStory[3]!, carerName: "Tom" };
const FACTS_DE: ChatFacts = { topics: roseDe().lifeStory, suggestedTopic: roseDe().lifeStory[1]!, carerName: "Tom" };
const TODAY = ["Today is Monday, October 12.", "You leave for Maple Grove Day Club at twenty to ten.", "Today is Monday."];

describe("RESPOND_TOOL", () => {
  it("is strict, closed, and offers only catalogue ids plus none", () => {
    expect(RESPOND_TOOL.strict).toBe(true);
    const schema = RESPOND_TOOL.inputSchema as { additionalProperties: boolean; required: string[]; properties: Record<string, { enum?: string[] }> };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["opener", "feeling", "question", "closing", "chat"]);
    expect(schema.properties.question!.enum).toEqual(["none", ...phraseIds("question")]);
    expect(schema.properties.chat!.enum).toBeUndefined();
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
    expect(compose([], { opener: "none", feeling: "none", question: "none", closing: "none", chat: "" }, DE)).toEqual(["Soll ich Tom um einen Anruf bitten?"]);
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
  it("cap: then the chat, then the question; tool sentences are never cut", () => {
    const five = [...TODAY, "Not yet.", "Now it's time for your morning pills."];
    expect(compose(five, { feeling: "im_glad", question: "offer_call" }, EN)).toEqual(five);
    const r = compose(TODAY, { feeling: "im_glad", chat: "You married Frank in 1966.", question: "offer_call" }, { ...EN, chatFacts: FACTS });
    expect(r).toEqual([...TODAY, "Shall I ask Tom to call you?"]);
    expect(r.length).toBeLessThanOrEqual(MAX_SENTENCES);
  });
  it("chat is ignored without chat facts", () => {
    expect(compose([], { chat: "You married Frank in 1966." }, EN)).toEqual(["Shall I ask Tom to call you?"]);
  });
  it("chat after the lead, before the question", () => {
    expect(compose([], { feeling: "im_here", chat: "You married Frank in 1966.", question: "offer_call" }, { ...EN, chatFacts: FACTS }))
      .toEqual(["I'm here with you.", "You married Frank in 1966.", "Shall I ask Tom to call you?"]);
  });
  it("readRespond treats non-strings as none", () => {
    expect(readRespond({ opener: 3, question: "offer_call", chat: null })).toEqual({ question: "offer_call" });
  });
});

describe("checkChat", () => {
  it("keeps facts from her life story, names and years included", () => {
    expect(checkChat("You married Frank in 1966. Was it a lovely day?", FACTS, EN)).toEqual(["You married Frank in 1966.", "Was it a lovely day?"]);
  });
  it("drops an invented year, number or name", () => {
    expect(checkChat("You won a prize in 1970.", FACTS, EN)).toEqual([]);
    expect(checkChat("You had five sisters.", FACTS, EN)).toEqual([]);
    expect(checkChat("Margaret came to visit.", FACTS, EN)).toEqual([]);
    expect(checkChat("You went to Paris with Frank.", FACTS, EN)).toEqual([]);
  });
  it("drops medication talk", () => {
    expect(checkChat("Your pills can wait.", FACTS, EN)).toEqual([]);
    expect(checkChat("Die Tablette ist wichtig.", FACTS_DE, DE)).toEqual([]);
  });
  it("drops open questions, keeps yes/no questions", () => {
    expect(checkChat("What did you grow in the garden?", FACTS, EN)).toEqual([]);
    expect(checkChat("Did you love the garden?", FACTS, EN)).toEqual(["Did you love the garden?"]);
    expect(checkChat("Was hast du gepflanzt?", FACTS_DE, DE)).toEqual([]);
  });
  it("drops sentences over twelve words", () => {
    expect(checkChat("You loved your garden and you loved the roses and the sun so much.", FACTS, EN)).toEqual([]);
  });
  it("at most two sentences and 200 characters", () => {
    expect(checkChat("You loved your garden. It was lovely. It was sunny.", FACTS, EN)).toEqual(["You loved your garden.", "It was lovely."]);
    const a = "You remember wonderful extraordinary marvellous unforgettable beautiful magnificent afternoons everywhere.";
    const b = "It was wonderfully extraordinary, marvellously unforgettable, beautifully magnificent, everlastingly peaceful.";
    expect(a.length + b.length).toBeGreaterThan(200);
    expect(checkChat(`${a} ${b}`, FACTS, EN)).toEqual([a]);
  });
  it("German chat from her German life story", () => {
    expect(checkChat("Du liebst deinen Rosengarten. Magst du die gelbe Kletterrose?", FACTS_DE, DE))
      .toEqual(["Du liebst deinen Rosengarten.", "Magst du die gelbe Kletterrose?"]);
  });
});
