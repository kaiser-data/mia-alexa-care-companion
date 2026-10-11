import { describe, expect, it } from "vitest";
import { phraseIds } from "@mia/shared";
import { compose, MAX_SENTENCES, readRespond, RESPOND_TOOL, type ToolSay } from "../src/compose";

const EN = { locale: "en-US" as const, name: "Rose", carer: "Tom" };
const DE = { locale: "de-DE" as const, name: "Rose", carer: "Tom" };
const TODAY = ["Today is Monday, October 12.", "You leave for Maple Grove Day Club at twenty to ten.", "Today is Monday."];
const PILLS = ["Not yet.", "Now it's time for your morning pills.", "That's the small white pill and the round pink one."];
const PROBLEM = ["I've let Tom know right away.", "Tom will get in touch with you."];
const g = (tool: string, says: string[]): ToolSay => ({ tool, says });

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
    expect(compose([g("get_medication_status", ["Not yet."])], { opener: "of_course", question: "anything_else" }, EN))
      .toEqual(["Of course, Rose.", "Not yet.", "Can I help with anything else?"]);
  });
  it("splits tool entries into sentences", () => {
    expect(compose([g("get_medication_status", ["Yes. You took them."])], null, EN)).toEqual(["Yes.", "You took them."]);
  });
  it("nothing to say → offer a call", () => {
    expect(compose([], null, EN)).toEqual(["Shall I ask Tom to call you?"]);
    expect(compose([], { opener: "none", feeling: "none", question: "none", closing: "none" }, DE)).toEqual(["Soll ich Tom um einen Anruf bitten?"]);
    expect(compose([g("get_today", [" "])], null, EN)).toEqual(["Shall I ask Tom to call you?"]);
  });
  it("feeling wins over opener; question wins over closing", () => {
    expect(compose([], { opener: "hello", feeling: "oh_dear", question: "offer_call", closing: "sleep_well" }, EN))
      .toEqual(["Oh dear.", "Shall I ask Tom to call you?"]);
  });
  it("a closing without a question", () => {
    expect(compose([], { closing: "sleep_well" }, DE)).toEqual(["Schlaf gut, Rose."]);
  });

  describe("no tool spoke: never a bare opener (I1)", () => {
    it("'Of course' alone is dropped: the call offer instead", () => {
      expect(compose([], { opener: "of_course" }, EN)).toEqual(["Shall I ask Tom to call you?"]);
      expect(compose([], { opener: "let_me_see" }, DE)).toEqual(["Soll ich Tom um einen Anruf bitten?"]);
    });
    it("'Of course' with a question: only the question", () => {
      expect(compose([], { opener: "of_course", question: "check_pills" }, EN)).toEqual(["Do you mean your pills?"]);
    });
    it("a feeling alone is followed by the call offer", () => {
      expect(compose([], { feeling: "oh_dear" }, EN)).toEqual(["Oh dear.", "Shall I ask Tom to call you?"]);
    });
    it("a greeting alone is followed by 'anything else'", () => {
      expect(compose([], { opener: "good_morning" }, EN)).toEqual(["Good morning, Rose.", "Can I help with anything else?"]);
      expect(compose([], { opener: "hello" }, DE)).toEqual(["Hallo, Rose.", "Kann ich sonst noch helfen?"]);
    });
    it("a greeting with a closing", () => {
      expect(compose([], { opener: "good_evening", closing: "sleep_well" }, EN)).toEqual(["Good evening, Rose.", "Sleep well, Rose."]);
    });
  });

  describe("at most four: whole answers by priority, key answer first (I2)", () => {
    it("pills before today; today dropped; the call offer kept", () => {
      const r = compose([g("get_today", TODAY), g("get_medication_status", PILLS)], { question: "offer_call" }, EN);
      expect(r).toEqual([...PILLS, "Shall I ask Tom to call you?"]);
    });
    it("report_problem before pills", () => {
      const r = compose([g("get_medication_status", PILLS), g("report_problem", PROBLEM)], null, EN);
      expect(r).toEqual(PROBLEM);
    });
    it("report_problem, then comfort, then others", () => {
      const r = compose([g("who_is", ["Frank is your husband."]), g("comfort_me", ["You're safe at home."]), g("report_problem", PROBLEM)], null, EN);
      expect(r).toEqual([...PROBLEM, "You're safe at home.", "Frank is your husband."]);
    });
    it("others keep their call order", () => {
      expect(compose([g("who_is", ["Tom is your son."]), g("get_today", ["Today is Monday."])], null, EN))
        .toEqual(["Tom is your son.", "Today is Monday."]);
    });
    it("a question reserves its slot: a four-sentence answer is spoken alone", () => {
      const four = [...TODAY, "Not yet."];
      expect(compose([g("get_today", four)], { question: "offer_call" }, EN)).toEqual(four);
    });
    it("a closing does not reserve a slot: it is dropped when four tool sentences fill the answer", () => {
      const four = [...TODAY, "Not yet."];
      expect(compose([g("get_today", four)], { closing: "lovely_day" }, EN)).toEqual(four);
    });
    it("one answer over four is spoken whole, alone", () => {
      const five = [...TODAY, "Not yet.", "Now it's time for your morning pills."];
      expect(compose([g("get_today", five), g("who_is", ["Tom is your son."])], { feeling: "im_glad", question: "offer_call" }, EN)).toEqual(five);
    });
    it("never cuts inside one answer", () => {
      const r = compose([g("get_medication_status", PILLS), g("who_is", ["Tom is your son.", "Tom calls you."])], { question: "anything_else" }, EN);
      expect(r).toEqual([...PILLS, "Can I help with anything else?"]);
    });
    it("the lead goes first", () => {
      expect(compose([g("get_today", TODAY)], { opener: "of_course", question: "anything_else" }, EN)).toEqual([...TODAY, "Can I help with anything else?"]);
      expect(compose([g("get_today", TODAY)], { opener: "of_course" }, EN)).toEqual(["Of course, Rose.", ...TODAY]);
    });
    it("every result is at most four sentences", () => {
      for (const groups of [[g("get_today", TODAY), g("get_medication_status", PILLS)], [g("report_problem", PROBLEM), g("get_today", TODAY)]])
        for (const question of ["none", "offer_call"])
          expect(compose(groups, { opener: "of_course", question }, EN).length).toBeLessThanOrEqual(MAX_SENTENCES);
    });
  });

  it("the lead is dropped when it repeats the first tool sentence (M1)", () => {
    expect(compose([g("confirm_medication", ["Thank you.", "I've noted your morning pills."])], { feeling: "thank_you" }, EN))
      .toEqual(["Thank you.", "I've noted your morning pills."]);
  });
  it("readRespond treats non-strings as none", () => {
    expect(readRespond({ opener: 3, question: "offer_call", feeling: null })).toEqual({ question: "offer_call" });
  });
  it("readRespond never passes on a free-text chat string", () => {
    expect(readRespond({ question: "tell_me_more", chat: "You can take them now." })).toEqual({ question: "tell_me_more" });
  });
});
