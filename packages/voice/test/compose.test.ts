import { beforeAll, describe, expect, it } from "vitest";
import { inMemoryMia } from "@mia/mcp-server/testing";
import { phraseIds, phraseText, rose, roseDe, splitSentences, templates, weekdayName, type Locale, type Weekday } from "@mia/shared";
import { at } from "@mia/shared/testing";
import { compose, MAX_SENTENCES, readRespond, RESPOND_TOOL, type ToolSay } from "../src/compose";
import { connectMia } from "../src/mcp";

const EN = { locale: "en-US" as const, name: "Rose", carer: "Tom" };
const DE = { locale: "de-DE" as const, name: "Rose", carer: "Tom" };
const TODAY = ["Today is Monday, October 12.", "You leave for Maple Grove Day Club at twenty to ten.", "Today is Monday."];
/** get_medication_status after an earlier dose with none due (production shape). */
const PILLS = ["You took your morning pills at eight o'clock.", "No more pills needed now.", "Your next pills are at six in the evening."];
/** get_medication_status with a dose due and none taken earlier. */
const DUE = ["Now it's time for your morning pills.", "That's the small white pill and the round pink one."];
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
    expect(compose([g("who_is", ["Frank is your husband."])], { opener: "of_course", question: "anything_else" }, EN))
      .toEqual(["Of course, Rose.", "Frank is your husband.", "Can I help with anything else?"]);
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
    const FOUR = ["One is here.", "Two is here.", "Three is here.", "Four is here."];
    it("a question reserves its slot: a four-sentence answer is spoken alone", () => {
      const four = FOUR;
      expect(compose([g("get_today", four)], { question: "offer_call" }, EN)).toEqual(four);
    });
    it("a closing does not reserve a slot: it is dropped when four tool sentences fill the answer", () => {
      const four = FOUR;
      expect(compose([g("get_today", four)], { closing: "lovely_day" }, EN)).toEqual(four);
    });
    it("one answer over four is spoken whole, alone", () => {
      const five = [...FOUR, "Five is here."];
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
      const next = ["Your next pills are at six in the evening."];
      expect(compose([g("chat_about_life", ["You grew up in Dayton.", "Do you remember that?"]), g("get_medication_status", next)], { question: "offer_call" }, EN))
        .toEqual([...next, "You grew up in Dayton.", "Do you remember that?"]);
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
      expect(compose([g("get_today", TODAY), g("play_music", ["Here is some Ella Fitzgerald."]), g("get_medication_status", DUE)], null, EN))
        .toEqual(["Now it's time for your morning pills.", "That's the small white pill and the round pink one.", "Here is some Ella Fitzgerald."]);
    });
    it("a group that does not fit is skipped; a later smaller one still fits (continue, not break)", () => {
      const big = ["One is here.", "Two is here.", "Three is here."];
      expect(compose([g("get_medication_status", DUE), g("who_is", big), g("get_today", ["Today is Monday, October 12."])], null, EN))
        .toEqual(["Now it's time for your morning pills.", "That's the small white pill and the round pink one.", "Today is Monday, October 12."]);
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
    health: [T.healthAsk(), T.askCarerFirst(C)],
    // Production shapes of get_medication_status: taken earlier + due (3), taken + no more now + next (3), due (2).
    pillsTakenDue: [T.medTaken(de ? "deine Morgentabletten" : "your morning pills", de ? "acht Uhr" : "eight o'clock"), T.medDue(de ? "deine Abendtablette" : "your evening pill"), T.medIs(de ? "die weiße Kapsel" : "the white capsule")],
    pills3: [T.medTaken(de ? "deine Morgentabletten" : "your morning pills", de ? "acht Uhr" : "eight o'clock"), T.noMoreNow(), T.medNextAt(de ? "sechs Uhr abends" : "six in the evening")],
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
    today: [T.todayIs(de ? "Montag, 12. Oktober" : "Monday, October 12"), T.leaveFor(de ? "die Tagesgruppe" : "Maple Grove Day Club", de ? "zwanzig vor zehn" : "twenty to ten"), T.repeatDay(de ? "Montag" : "Monday")],
    night: [T.nightIs(de ? "drei Uhr" : "three o'clock"), T.nightSafe()],
    // get_next_appointment on a day without the group: the answer and its repeated day ("On Monday.").
    apptNot: [T.apptNotToday(de ? "Tagesgruppe" : "Maple Grove Day Club", de ? "Montag" : "Monday"), T.onDay(de ? "Montag" : "Monday")],
  };
}

describe.each([["en", EN], ["de", DE]] as const)("pills first, one call offer at most (fix round 3, %s)", (_, ctx) => {
  const F = fixtures(ctx.locale);
  const anything = phraseText("anything_else", ctx.locale, ctx)!;

  it("I-B: a side-effect called before the pills never displaces them; the reserved question slot is released", () => {
    const pills = splitAll(F.pills3, ctx.locale);
    for (const side of ["request_call", "play_music"] as const) {
      const says = side === "request_call" ? F.call : F.music;
      expect(compose([g(side, says), g("get_medication_status", F.pills3)], { question: "anything_else" }, ctx)).toEqual([...pills, ...says]);
      expect(compose([g("get_medication_status", F.pills3), g(side, says)], { question: "anything_else" }, ctx)).toEqual([...pills, ...says]);
    }
  });
  it("I-2: pills (3) + report_home: the welcome is kept and its question dropped, in either call order", () => {
    const pills = splitAll(F.pills3, ctx.locale);
    expect(compose([g("report_home", F.home), g("get_medication_status", F.pills3)], null, ctx)).toEqual([...pills, F.home[0]]);
    expect(compose([g("get_medication_status", F.pills3), g("report_home", F.home)], null, ctx)).toEqual([...pills, F.home[0]]);
  });
  it("pills (taken + due) + report_home: the pills first, the welcome after them, its question gives way", () => {
    expect(compose([g("report_home", F.home), g("get_medication_status", F.pillsTakenDue)], null, ctx)).toEqual([...F.pillsTakenDue, F.home[0]]);
  });
  it("I-B: report_problem, then the pills, then side-effects, then the rest", () => {
    expect(compose([g("play_music", F.music), g("get_medication_status", F.pills2), g("report_problem", F.problem)], { question: "anything_else" }, ctx))
      .toEqual([...F.problem, ...F.pills2]);
    expect(compose([g("who_is", F.who), g("play_music", F.music), g("confirm_medication", F.confirm)], { question: "anything_else" }, ctx))
      .toEqual([...splitAll(F.confirm, ctx.locale), ...F.music, ...F.who]);
    // A picked question only takes a place no fact can use.
    expect(compose([g("play_music", F.music), g("confirm_medication", F.confirm)], { question: "anything_else" }, ctx))
      .toEqual([...splitAll(F.confirm, ctx.locale), ...F.music, anything]);
  });
  it("I-A: comfort_me + a one-sentence fact + offer_call: the offer is spoken once, last, with its own fact", () => {
    expect(compose([g("comfort_me", F.comfort), g("who_is", F.who)], { question: "offer_call" }, ctx))
      .toEqual([...F.who, ...F.comfort]);
  });
  it("I-1: report_leaving's question moves last together with its own fact; no picked question follows", () => {
    expect(compose([g("report_leaving", F.leaving), g("who_is", F.who)], { question: "anything_else" }, ctx))
      .toEqual([...F.who, ...F.leaving]);
  });
  it("I-1: report_home's question moves last together with its own fact; no closing follows", () => {
    expect(compose([g("who_is", F.who), g("report_home", F.home)], { closing: "lovely_day" }, ctx))
      .toEqual([...F.who, ...F.home]);
  });
  it("I-A: two tool questions: only the higher-ranked one is asked, last, after its own fact; both facts are kept", () => {
    expect(compose([g("chat_about_life", F.chat), g("comfort_me", F.comfort)], { question: "tell_me_more" }, ctx))
      .toEqual([F.chat[0], ...F.comfort]);
  });
  it("I-1: chat_about_life + who_is: 'Do you remember that?' follows the life-story sentence, in either call order", () => {
    expect(compose([g("chat_about_life", F.chat), g("who_is", F.who)], null, ctx)).toEqual([...F.who, ...F.chat]);
    expect(compose([g("who_is", F.who), g("chat_about_life", F.chat)], null, ctx)).toEqual([...F.who, ...F.chat]);
  });
  it("I-2: pills (due) + report_home + request_call: the call is confirmed; the welcome-home question gives way", () => {
    expect(compose([g("get_medication_status", F.pills2), g("report_home", F.home), g("request_call", F.call)], null, ctx))
      .toEqual([...F.pills2, F.home[0], ...F.call]);
  });
  it("I-2: pills (due) + report_leaving + play_music: the music is announced; the keys question gives way", () => {
    expect(compose([g("get_medication_status", F.pills2), g("report_leaving", F.leaving), g("play_music", F.music)], null, ctx))
      .toEqual([...F.pills2, F.leaving[0], ...F.music]);
  });
  it("I-C: comfort_me + request_call: the call is confirmed and never offered again, in either order", () => {
    expect(compose([g("comfort_me", F.comfort), g("request_call", F.call)], { question: "offer_call" }, ctx)).toEqual([...F.call, F.comfort[0]]);
    expect(compose([g("request_call", F.call), g("comfort_me", F.comfort)], null, ctx)).toEqual([...F.call, F.comfort[0]]);
  });
  it("ask_carer_about_health is never dropped beside get_today, a lead and a picked question, in either call order", () => {
    for (const choice of [null, { opener: "of_course", question: "anything_else" }, { feeling: "oh_dear", question: "offer_call" }, { closing: "lovely_day" }]) {
      for (const says of [[g("get_today", F.today), g("ask_carer_about_health", F.health)], [g("ask_carer_about_health", F.health), g("get_today", F.today)]]) {
        const out = compose(says, choice, ctx);
        // First, after at most a lead phrase.
        const at = out.indexOf(F.health[0]!);
        expect(at, JSON.stringify(out)).toBeGreaterThanOrEqual(0);
        expect(at).toBeLessThanOrEqual(1);
        expect(out.slice(at, at + 2), JSON.stringify(choice)).toEqual(F.health);
        expect(out.length).toBeLessThanOrEqual(MAX_SENTENCES);
      }
    }
  });
  it("ask_carer_about_health comes before the pills and is never cut; the pills follow when they fit", () => {
    // A due dose is never prompted beside a health question (round 6 review I-2); the other pill facts may follow.
    expect(compose([g("get_medication_status", F.pills2), g("ask_carer_about_health", F.health)], { question: "anything_else" }, ctx)).toEqual([...F.health, anything]);
    expect(compose([g("ask_carer_about_health", F.health), g("get_medication_status", F.pillsTakenDue)], null, ctx)).toEqual([...F.health, F.pillsTakenDue[0]]);
    expect(compose([g("get_medication_status", F.pillsTakenDue), g("ask_carer_about_health", F.health)], { question: "anything_else" }, ctx)).toEqual([...F.health, F.pillsTakenDue[0], anything]);
    expect(compose([g("get_medication_status", F.pills2)], null, ctx)).toEqual(F.pills2);
    expect(compose([g("get_medication_status", F.pills3), g("ask_carer_about_health", F.health)], null, ctx)).toEqual(F.health);
    expect(compose([g("ask_carer_about_health", F.health), g("report_problem", F.problem)], null, ctx)).toEqual([...F.problem, ...F.health]);
  });
  it("I-C: request_call + an empty-life-story chat (only a call offer): no offer", () => {
    expect(compose([g("chat_about_life", F.chatEmpty), g("request_call", F.call)], null, ctx)).toEqual(F.call);
  });
});

describe.each([["en", EN], ["de", DE]] as const)("the repeated day is the first thing given up (%s)", (_, ctx) => {
  const T = templates(ctx.locale);
  const de = ctx.locale === "de-DE";
  // get_today on Sunday, October 11, in the evening: the date, the next routine (bedtime), the day repeated.
  const sunday = [T.todayIs(de ? "Sonntag, der 11. Oktober" : "Sunday, October 11"), T.nextRoutine(de ? "Schlafenszeit" : "bedtime", de ? "halb zehn abends" : "half past nine in the evening"), T.repeatDay(de ? "Sonntag" : "Sunday")];
  // get_next_appointment on a day without the group: the real tool shape, "Not today. … is on Monday." + "On Monday.".
  const appointment = [T.apptNotToday(de ? "Tagesgruppe" : "Maple Grove Day Club", de ? "Montag" : "Monday"), T.onDay(de ? "Montag" : "Monday")];

  it("get_today alone still speaks all three sentences", () => {
    expect(compose([g("get_today", sunday)], null, ctx)).toEqual(sunday);
    expect(compose([g("get_today", sunday)], { question: "anything_else" }, ctx)).toEqual([...sunday, phraseText("anything_else", ctx.locale, ctx)]);
  });
  it("get_next_appointment alone still speaks all three sentences", () => {
    const appt = splitAll(appointment, ctx.locale);
    expect(appt).toHaveLength(3);
    expect(compose([g("get_next_appointment", appointment)], null, ctx)).toEqual(appt);
  });
  it("get_today + get_next_appointment: both repeated days give way, both answers fit, in either call order (I-3)", () => {
    const [notToday, isOn] = splitAll(appointment, ctx.locale);
    expect(compose([g("get_today", sunday), g("get_next_appointment", appointment)], null, ctx)).toEqual([sunday[0], sunday[1], notToday, isOn]);
    expect(compose([g("get_next_appointment", appointment), g("get_today", sunday)], null, ctx)).toEqual([notToday, isOn, sunday[0], sunday[1]]);
  });
  it("the repeated day gives way to a question, and is kept before a lead or a closing", () => {
    const who = [T.personIs("Frank", de ? "dein Mann" : "husband")];
    expect(compose([g("get_today", sunday), g("who_is", who)], { question: "offer_call" }, ctx)).toEqual([sunday[0], sunday[1], ...who, T.callOffer("Tom")]);
    expect(compose([g("get_today", sunday), g("who_is", who)], { opener: "of_course", closing: "lovely_day" }, ctx)).toEqual([...sunday, ...who]);
  });
});

const splitAll = (says: string[], locale: Locale) => says.flatMap((s) => splitSentences(s, locale));

/**
 * Invariants of compose(), checked on every output of a table of tool combinations, in every call order, en and de:
 * 1. Never silence: at least one sentence.
 * 2. At most four sentences, each at most twelve words.
 * 3. At most one question, and it is the last sentence.
 * 4. A call that request_call just made is never offered.
 * 5. The pills are never dropped or displaced by side-effect answers: right after report_problem and
 *    ask_carer_about_health (or first), after at most a lead phrase; kept whenever they fit in four beside those.
 *    ask_carer_about_health is held to the same rule, right after report_problem.
 * 6. No sentence is spoken twice.
 * 7. A tool's own question is spoken right after a sentence of that same tool (when the tool has any other sentence):
 *    "Do you remember that?" always follows the life-story sentence it refers to.
 * 8. A side-effect confirmation is dropped only when report_problem, the pills and the side-effects called before it
 *    already fill the four places with it: then nothing else is spoken, no question and no lower-ranked answer.
 * 9. get_today's repeated day ("Today is Monday.") is the first thing given up: when its answer is spoken without it
 *    and no answer was skipped, the answer is full and holds no lead or closing.
 * 10. A repeated day ("Today is Sunday.", "On Monday.") is spoken only when every answer's facts are spoken.
 * 11. A question the LLM picked never takes a place before a fact: when it is spoken, every skipped answer without
 *     its own question could not have fitted in four beside the facts that are spoken.
 * 12. Beside a pill or health answer no opener or feeling is spoken (only a greeting could lead, and the table picks none).
 * 13. Beside ask_carer_about_health no due-dose line ("Now it's time…", "That's the…") is spoken; (5)-(11) count
 *     only what the pill tool can be heard to say there.
 * The pool holds the real get_today and get_next_appointment output of a group day and a day without the group,
 * so (6) "no sentence twice" is checked on what the tools really say.
 */
describe.each([["en", EN], ["de", DE]] as const)("compose invariants over tool combinations (%s)", (_, ctx) => {
  const F = fixtures(ctx.locale);
  const T = templates(ctx.locale);
  const REPEATS = new Set(([1, 2, 3, 4, 5, 6, 7] as Weekday[]).flatMap((w) => [T.repeatDay(weekdayName(w, ctx.locale)), T.onDay(weekdayName(w, ctx.locale))]));
  const REAL: ToolSay[] = [];
  beforeAll(async () => {
    // Real tool output: Monday 09:50 (group day, both tools name the group start) and Sunday 19:00 (no group).
    for (const time of ["2026-10-12T09:50:00", "2026-10-11T19:00:00"]) {
      const m = await inMemoryMia({ now: () => at(time), profile: ctx.locale === "de-DE" ? roseDe() : rose() });
      const mia = await connectMia({ url: m.url, token: m.token, fetch: m.fetch });
      REAL.push(g("get_today", (await mia.call("get_today")).say));
      REAL.push(g("get_next_appointment", (await mia.call("get_next_appointment", { name: ctx.locale === "de-DE" ? "Gruppe" : "group" })).say));
    }
  });
  const POOL: ToolSay[] = [
    g("report_problem", F.problem), g("get_medication_status", F.pillsTakenDue), g("get_medication_status", F.pills3), g("get_medication_status", F.pills2),
    g("confirm_medication", F.confirm), g("request_call", F.call), g("play_music", F.music), g("report_leaving", F.leaving), g("report_home", F.home),
    g("comfort_me", F.comfort), g("chat_about_life", F.chat), g("chat_about_life", F.chatEmpty), g("who_is", F.who), g("get_today", F.today),
    g("night_reassurance", F.night), g("get_next_appointment", F.apptNot), g("ask_carer_about_health", F.health),
  ];
  const CHOICES = [
    null, { question: "offer_call" }, { question: "anything_else" }, { closing: "lovely_day" },
    { feeling: "oh_dear", question: "offer_call" }, { opener: "of_course", closing: "sleep_well" }, { feeling: "thank_you", question: "tell_me_more" },
  ];
  const MEDS = ["get_medication_status", "confirm_medication"];
  const DUE_LINES = new Set([F.pillsTakenDue[1]!, F.pillsTakenDue[2]!, ...F.pills2]);
  const SIDE = ["request_call", "play_music", "report_leaving", "report_home"];
  const isQ = (s: string) => s.trimEnd().endsWith("?");
  const CLOSINGS = new Set(CHOICES.flatMap((c) => (c?.closing ? [phraseText(c.closing, ctx.locale, ctx)!] : [])));
  const LEADS = new Set(CHOICES.flatMap((c) => [c?.feeling, c?.opener]).flatMap((id) => (id ? [phraseText(id, ctx.locale, ctx)!] : [])));
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
    POOL.push(...REAL);
    let checked = 0;
    for (const says of combos()) {
      for (const choice of CHOICES) {
        const out = compose(says, choice, ctx);
        // What each tool can be heard to say: beside a health question the pill tool's due lines are never spoken.
        const health = says.some((s) => s.tool === "ask_carer_about_health");
        const heard = (s: ToolSay) => splitAll(s.says, ctx.locale).filter((x) => !(health && s.tool === "get_medication_status" && DUE_LINES.has(x)));
        const tag = `${says.map((s) => s.tool).join("+")} ${JSON.stringify(choice)} → ${JSON.stringify(out)}`;
        expect(out.length, tag).toBeGreaterThan(0);
        expect(out.length, tag).toBeLessThanOrEqual(MAX_SENTENCES);
        for (const s of out) expect(words(s), tag).toBeLessThanOrEqual(12);
        const asks = out.flatMap((s, i) => (s.trimEnd().endsWith("?") ? [i] : []));
        expect(asks.length, tag).toBeLessThanOrEqual(1);
        if (asks.length) expect(asks[0], tag).toBe(out.length - 1);
        if (says.some((s) => s.tool === "request_call")) expect(out, tag).not.toContain(F.callOffer);
        expect(new Set(out).size, tag).toBe(out.length);
        // (5) report_problem, then ask_carer_about_health, then the pills: each whole, first, or while all fit in four.
        const top = [says.find((s) => s.tool === "report_problem"), says.find((s) => s.tool === "ask_carer_about_health"), says.find((s) => MEDS.includes(s.tool))];
        if (top[1] || top[2]) {
          const prefix: string[] = [];
          for (const t of top) {
            if (!t) continue;
            const ts = heard(t);
            if (!ts.length) continue;
            if (!prefix.length || prefix.length + ts.length <= MAX_SENTENCES) prefix.push(...ts);
          }
          const at = out[0] === prefix[0] ? 0 : 1;
          if (at === 1) expect(LEADS.has(out[0]!), tag).toBe(true);
          expect(out.slice(at, at + prefix.length), tag).toEqual(prefix);
        }
        const last = out.at(-1)!;
        for (const s of says) {
          const sentences = splitAll(s.says, ctx.locale);
          const facts = sentences.filter((x) => !isQ(x));
          // (7) The question is this tool's own and its facts are spoken: the sentence before it is one of them.
          // (Facts another tool also says, like night_reassurance's "You're safe at home.", cannot tell whose answer was kept.)
          const shared = says.some((o) => o !== s && splitAll(o.says, ctx.locale).some((x) => facts.includes(x)));
          if (isQ(last) && sentences.includes(last) && facts.length && !shared && facts.some((f) => out.includes(f))) expect(facts, tag).toContain(out.at(-2));
        }
        // (13) Beside a health question no due-dose line is spoken.
        if (health) for (const x of out) expect(DUE_LINES.has(x), tag).toBe(false);
        const factsIn = (s: ToolSay) => heard(s).filter((x) => !isQ(x) && !REPEATS.has(x));
        const skipped = says.filter((s) => factsIn(s).some((f) => !out.includes(f)));
        // (10) A repeated day only when no answer was skipped.
        if (skipped.length) for (const x of out) expect(REPEATS.has(x), tag).toBe(false);
        // (11) A picked question (not a tool's own) never displaces a fact.
        const toolQs = new Set(says.flatMap((s) => splitAll(s.says, ctx.locale).filter(isQ)));
        if (isQ(last) && !toolQs.has(last)) {
          const allFacts = new Set(says.flatMap(factsIn));
          const spokenFacts = out.filter((x) => allFacts.has(x)).length;
          for (const s of skipped) {
            if (splitAll(s.says, ctx.locale).some(isQ)) continue;
            const fresh = new Set(factsIn(s).filter((f) => !out.includes(f))).size;
            expect(spokenFacts + fresh, tag).toBeGreaterThan(MAX_SENTENCES);
          }
        }
        if (!skipped.length && says.some((s) => s.tool === "get_today") && out.includes(F.today[0]!) && !out.includes(F.today[2]!)) {
          expect(out.length, tag).toBe(MAX_SENTENCES);
          const fromTools = new Set(says.flatMap((s) => splitAll(s.says, ctx.locale)));
          for (const s of out) if (!fromTools.has(s)) expect(LEADS.has(s) || CLOSINGS.has(s), tag).toBe(false);
        }
        // (12) No lead before a pill or health answer.
        const plain = says.filter((s) => [...MEDS, "ask_carer_about_health"].includes(s.tool)).flatMap((s) => splitAll(s.says, ctx.locale));
        const said = new Set(says.flatMap((s) => splitAll(s.says, ctx.locale)));
        if (plain.some((x) => out.includes(x))) for (const x of out) if (!said.has(x)) expect(LEADS.has(x), tag).toBe(false);
        const factsOf = (tools: string[]) => says.filter((s) => tools.includes(s.tool)).flatMap((s) => heard(s).filter((x) => !isQ(x)));
        // (8) Side-effects are walked in call order, right after report_problem and the pills.
        const factsOf8 = (s: ToolSay) => heard(s).filter((x) => !isQ(x));
        const sides = says.filter((s) => SIDE.includes(s.tool));
        const higher = new Set([...factsOf(["report_problem", "ask_carer_about_health", ...MEDS]), ...sides.flatMap(factsOf8)]);
        for (const [k, side] of sides.entries()) {
          const facts = factsOf8(side);
          if (facts.every((f) => out.includes(f))) continue;
          const before = [...factsOf(["report_problem", "ask_carer_about_health", ...MEDS]), ...sides.slice(0, k).flatMap(factsOf8)].filter((f) => out.includes(f));
          expect(before.length + facts.length, tag).toBeGreaterThan(MAX_SENTENCES);
          for (const x of out) expect(higher.has(x), tag).toBe(true);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10_000);
  }, 30_000);
});
