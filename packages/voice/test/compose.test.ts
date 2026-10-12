import { describe, expect, it } from "vitest";
import { phraseIds, phraseText, splitSentences, templates, type Locale } from "@mia/shared";
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

  describe("one question at most, always last (I-1)", () => {
    it("a tool answer that already ends in a question gets no second question or closing", () => {
      expect(compose([g("chat_about_life", ["You grew up in Dayton.", "Do you remember that?"])], { question: "offer_call" }, EN))
        .toEqual(["You grew up in Dayton.", "Do you remember that?"]);
      expect(compose([g("chat_about_life", ["Du liebst deinen Rosengarten.", "Erinnerst du dich daran?"])], { question: "offer_call", closing: "sleep_well" }, DE))
        .toEqual(["Du liebst deinen Rosengarten.", "Erinnerst du dich daran?"]);
    });
    it("comfort_me already offers the call: the offer is not repeated", () => {
      expect(compose([g("comfort_me", ["You're safe at home.", "Shall I ask Tom to call you?"])], { question: "offer_call" }, EN))
        .toEqual(["You're safe at home.", "Shall I ask Tom to call you?"]);
      expect(compose([g("comfort_me", ["Du bist zu Hause sicher.", "Soll ich Tom um einen Anruf bitten?"])], { question: "offer_call" }, DE))
        .toEqual(["Du bist zu Hause sicher.", "Soll ich Tom um einen Anruf bitten?"]);
    });
    it("the check looks at the last kept sentence after ranking", () => {
      expect(compose([g("chat_about_life", ["You grew up in Dayton.", "Do you remember that?"]), g("get_medication_status", PILLS.slice(0, 1))], { question: "offer_call" }, EN))
        .toEqual(["Not yet.", "You grew up in Dayton.", "Do you remember that?"]);
    });
  });

  describe("side-effect answers are never cut (I-2)", () => {
    it("request_call ranks with the pills: confirmed, and no call offer is made", () => {
      expect(compose([g("get_medication_status", PILLS), g("request_call", ["I've asked Tom to call you."])], { question: "offer_call" }, EN))
        .toEqual([...PILLS, "I've asked Tom to call you."]);
      expect(compose([g("get_medication_status", PILLS), g("request_call", ["Ich habe Tom um einen Anruf gebeten."])], { question: "offer_call" }, DE))
        .toEqual([...PILLS, "Ich habe Tom um einen Anruf gebeten."]);
    });
    it("request_call with room left: no call offer; the closing may follow", () => {
      expect(compose([g("request_call", ["I've asked Tom to call you."])], { question: "offer_call", closing: "lovely_day" }, EN))
        .toEqual(["I've asked Tom to call you.", "Have a lovely day, Rose."]);
      expect(compose([g("request_call", ["I've asked Tom to call you."])], { question: "offer_call" }, EN))
        .toEqual(["I've asked Tom to call you."]);
    });
    it("request_call without any say still never gets a call offer", () => {
      expect(compose([g("request_call", [])], { question: "offer_call" }, EN)).toEqual(["Can I help with anything else?"]);
    });
    it("play_music, report_leaving and report_home outrank other answers", () => {
      for (const tool of ["play_music", "report_leaving", "report_home"])
        expect(compose([g("get_today", TODAY), g(tool, ["Here is some Ella Fitzgerald."])], null, EN))
          .toEqual(["Here is some Ella Fitzgerald.", ...TODAY.slice(0, 3)]);
      expect(compose([g("who_is", ["Tom is your son.", "Tom calls you.", "Tom is kind."]), g("play_music", ["Here is some Ella Fitzgerald.", "Enjoy."])], null, EN))
        .toEqual(["Here is some Ella Fitzgerald.", "Enjoy."]);
    });
    it("play_music is spoken when pills and today would fill the cap; the pills stay first (I-B)", () => {
      expect(compose([g("get_today", TODAY), g("play_music", ["Here is some Ella Fitzgerald."]), g("get_medication_status", PILLS.slice(0, 2))], null, EN))
        .toEqual(["Not yet.", "Now it's time for your morning pills.", "Here is some Ella Fitzgerald."]);
    });
    it("a group that does not fit is skipped; a later smaller one still fits (continue, not break)", () => {
      const big = ["One is here.", "Two is here.", "Three is here."];
      expect(compose([g("get_medication_status", PILLS.slice(0, 2)), g("who_is", big), g("get_today", ["Today is Monday."])], null, EN))
        .toEqual(["Not yet.", "Now it's time for your morning pills.", "Today is Monday."]);
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

/** Real template sentences for one locale, so the invariants run on what Rose would really hear. */
function fixtures(locale: Locale) {
  const T = templates(locale);
  const de = locale === "de-DE";
  const C = "Tom";
  return {
    callOffer: T.callOffer(C),
    problem: [T.distressAck(C), T.distressFollow(C)],
    pills4: [T.medTaken(de ? "deine Morgentabletten" : "your morning pills", de ? "acht Uhr" : "eight o'clock"), T.medDue(de ? "deine Abendtablette" : "your evening pill"), T.medIs(de ? "die weiße Kapsel" : "the white capsule")],
    pills3: [T.notYet(), T.medDue(de ? "deine Morgentabletten" : "your morning pills"), T.medIs(de ? "die kleine weiße Tablette" : "the small white pill")],
    pills2: [T.medDue(de ? "deine Abendtablette" : "your evening pill"), T.medIs(de ? "die weiße Kapsel" : "the white capsule")],
    confirm: [T.medConfirmed(de ? "deine Morgentabletten" : "your morning pills")],
    call: [T.callRequested(C)],
    music: [T.musicStart("Ella Fitzgerald")],
    leaving: [T.leavingOk(), T.keysCheck()],
    home: [T.welcomeHome("Rose"), T.niceTime()],
    comfort: [T.safeAtHome(), T.callOffer(C)],
    chat: [de ? "Du liebst deinen Rosengarten." : "You grew up in Dayton.", T.rememberAsk()],
    chatEmpty: [T.callOffer(C)],
    who: [T.personIs("Frank", de ? "dein Mann" : "husband")],
    today: [T.todayIs(de ? "Montag, 12. Oktober" : "Monday, October 12"), T.leaveFor(de ? "die Tagesgruppe" : "Maple Grove Day Club", de ? "zwanzig vor zehn" : "twenty to ten")],
    night: [T.nightIs(de ? "drei Uhr" : "three o'clock"), T.nightSafe()],
  };
}

describe.each([["en", EN], ["de", DE]] as const)("pills first, one call offer at most (fix round 3, %s)", (_, ctx) => {
  const F = fixtures(ctx.locale);
  const anything = phraseText("anything_else", ctx.locale, ctx)!;

  it("I-B: a side-effect called before the pills never displaces them; the reserved question slot is released", () => {
    for (const side of ["request_call", "play_music"] as const) {
      const says = side === "request_call" ? F.call : F.music;
      expect(compose([g(side, says), g("get_medication_status", F.pills3)], { question: "anything_else" }, ctx)).toEqual([...F.pills3, ...says]);
      expect(compose([g("get_medication_status", F.pills3), g(side, says)], { question: "anything_else" }, ctx)).toEqual([...F.pills3, ...says]);
    }
  });
  it("I-B: pills (3) + report_home (2) cannot both fit: the pills win in either call order", () => {
    expect(compose([g("report_home", F.home), g("get_medication_status", F.pills3)], null, ctx)).toEqual(F.pills3);
    expect(compose([g("get_medication_status", F.pills3), g("report_home", F.home)], null, ctx)).toEqual(F.pills3);
  });
  it("I-B: report_problem, then the pills, then side-effects, then the rest", () => {
    expect(compose([g("play_music", F.music), g("get_medication_status", F.pills2), g("report_problem", F.problem)], { question: "anything_else" }, ctx))
      .toEqual([...F.problem, ...F.pills2]);
    expect(compose([g("who_is", F.who), g("play_music", F.music), g("confirm_medication", F.confirm)], { question: "anything_else" }, ctx))
      .toEqual([...splitAll(F.confirm, ctx.locale), ...F.music, anything]);
  });
  it("I-A: comfort_me + a one-sentence fact + offer_call: the offer is spoken once, last", () => {
    expect(compose([g("comfort_me", F.comfort), g("who_is", F.who)], { question: "offer_call" }, ctx))
      .toEqual([F.comfort[0], ...F.who, F.callOffer]);
  });
  it("I-A: report_leaving's question mid-turn moves last; no picked question follows", () => {
    expect(compose([g("report_leaving", F.leaving), g("who_is", F.who)], { question: "anything_else" }, ctx))
      .toEqual([F.leaving[0], ...F.who, F.leaving[1]]);
  });
  it("I-A: report_home's question mid-turn moves last; no closing follows", () => {
    expect(compose([g("who_is", F.who), g("report_home", F.home)], { closing: "lovely_day" }, ctx))
      .toEqual([F.home[0], ...F.who, F.home[1]]);
  });
  it("I-A: two tool questions: only the higher-ranked one is asked, last; both facts are kept", () => {
    expect(compose([g("chat_about_life", F.chat), g("comfort_me", F.comfort)], { question: "tell_me_more" }, ctx))
      .toEqual([F.comfort[0], F.chat[0], F.callOffer]);
  });
  it("I-C: comfort_me + request_call: the call is confirmed and never offered again, in either order", () => {
    expect(compose([g("comfort_me", F.comfort), g("request_call", F.call)], { question: "offer_call" }, ctx)).toEqual([...F.call, F.comfort[0]]);
    expect(compose([g("request_call", F.call), g("comfort_me", F.comfort)], null, ctx)).toEqual([...F.call, F.comfort[0]]);
  });
  it("I-C: request_call + an empty-life-story chat (only a call offer): no offer", () => {
    expect(compose([g("chat_about_life", F.chatEmpty), g("request_call", F.call)], null, ctx)).toEqual(F.call);
  });
});

const splitAll = (says: string[], locale: Locale) => says.flatMap((s) => splitSentences(s, locale));

/**
 * Invariants of compose(), checked on every output of a table of tool combinations, in every call order, en and de:
 * 1. Never silence: at least one sentence.
 * 2. At most four sentences, each at most twelve words.
 * 3. At most one question, and it is the last sentence.
 * 4. A call that request_call just made is never offered.
 * 5. The pills are never dropped or displaced by side-effect answers: right after report_problem (or first),
 *    after at most a lead; with report_problem they are kept whenever both fit in four.
 * 6. No sentence is spoken twice.
 */
describe.each([["en", EN], ["de", DE]] as const)("compose invariants over tool combinations (%s)", (_, ctx) => {
  const F = fixtures(ctx.locale);
  const POOL: ToolSay[] = [
    g("report_problem", F.problem), g("get_medication_status", F.pills4), g("get_medication_status", F.pills3), g("get_medication_status", F.pills2),
    g("confirm_medication", F.confirm), g("request_call", F.call), g("play_music", F.music), g("report_leaving", F.leaving), g("report_home", F.home),
    g("comfort_me", F.comfort), g("chat_about_life", F.chat), g("chat_about_life", F.chatEmpty), g("who_is", F.who), g("get_today", F.today),
    g("night_reassurance", F.night),
  ];
  const CHOICES = [
    null, { question: "offer_call" }, { question: "anything_else" }, { closing: "lovely_day" },
    { feeling: "oh_dear", question: "offer_call" }, { opener: "of_course", closing: "sleep_well" }, { feeling: "thank_you", question: "tell_me_more" },
  ];
  const MEDS = ["get_medication_status", "confirm_medication"];
  const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

  function* combos(): Generator<ToolSay[]> {
    for (const a of POOL) {
      yield [a];
      for (const b of POOL) {
        if (b.tool === a.tool) continue;
        yield [a, b];
        for (const c of POOL) if (c.tool !== a.tool && c.tool !== b.tool) yield [a, b, c];
      }
    }
  }

  it("hold for every combination, call order and phrase choice", () => {
    let checked = 0;
    for (const says of combos()) {
      for (const choice of CHOICES) {
        const out = compose(says, choice, ctx);
        const tag = `${says.map((s) => s.tool).join("+")} ${JSON.stringify(choice)} → ${JSON.stringify(out)}`;
        expect(out.length, tag).toBeGreaterThan(0);
        expect(out.length, tag).toBeLessThanOrEqual(MAX_SENTENCES);
        for (const s of out) expect(words(s), tag).toBeLessThanOrEqual(12);
        const asks = out.flatMap((s, i) => (s.trimEnd().endsWith("?") ? [i] : []));
        expect(asks.length, tag).toBeLessThanOrEqual(1);
        if (asks.length) expect(asks[0], tag).toBe(out.length - 1);
        if (says.some((s) => s.tool === "request_call")) expect(out, tag).not.toContain(F.callOffer);
        expect(new Set(out).size, tag).toBe(out.length);
        const med = says.find((s) => MEDS.includes(s.tool));
        if (med) {
          const medS = splitAll(med.says, ctx.locale);
          const problem = says.some((s) => s.tool === "report_problem");
          const prefix = problem ? [...F.problem, ...(F.problem.length + medS.length <= MAX_SENTENCES ? medS : [])] : medS;
          const at = out[0] === prefix[0] ? 0 : 1;
          expect(out.slice(at, at + prefix.length), tag).toEqual(prefix);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10_000);
  });
});
