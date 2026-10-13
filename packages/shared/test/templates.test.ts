import { describe, expect, it } from "vitest";
import { templates } from "../src/i18n/templates";
import { checkPlain, splitSentences } from "../src/i18n/plain";
import { rose, roseDe } from "../src/seed/rose";

describe("splitSentences", () => {
  it("splits on . ! ?", () => expect(splitSentences("Yes. You took them! Good?")).toEqual(["Yes.", "You took them!", "Good?"]));
  it("splits after an English date", () =>
    expect(splitSentences("Today is Monday, October 12. Today is Monday.")).toEqual(["Today is Monday, October 12.", "Today is Monday."]));
  it("does not split German ordinal dates", () =>
    expect(splitSentences("Heute ist Montag, der 12. Oktober. Heute ist Montag.", "de-DE")).toEqual(["Heute ist Montag, der 12. Oktober.", "Heute ist Montag."]));
});

describe("checkPlain", () => {
  it("accepts short sentences", () => expect(checkPlain("Today is Monday. Today is Monday.", "en-US").ok).toBe(true));
  it("rejects sentences over 12 words", () => {
    const r = checkPlain("This sentence has far too many words for an older listener to follow easily.", "en-US");
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/words/);
  });
  it("rejects more than 4 sentences", () => expect(checkPlain("A. B. C. D. E.", "en-US").ok).toBe(false));
  it("rejects 'already asked'", () => expect(checkPlain("You already asked that.", "en-US").ok).toBe(false));
  it("rejects 'wie gesagt'", () => expect(checkPlain("Wie gesagt, heute ist Montag.", "de-DE").ok).toBe(false));
  it("is stricter for very_simple", () => expect(checkPlain("Your next pills are at eight in the evening.", "en-US", "very_simple").ok).toBe(false));
});

describe("templates", () => {
  const all = (locale: "en-US" | "de-DE", carer: string) => {
    const T = templates(locale);
    return [
      T.todayIs("Monday, October 12"), T.repeatDay("Monday"), T.leaveFor("Maple Grove Day Club", "twenty to ten"),
      T.apptAt("Maple Grove Day Club", "ten o'clock"), T.apptUntil("Maple Grove Day Club", "two o'clock"),
      T.apptTodayYes("Maple Grove Day Club"), T.apptNotToday("Maple Grove Day Club", "Thursday"), T.onDay("Thursday"),
      T.nothingToday(), T.nextRoutine("supper", "six o'clock"), T.dontKnow(carer), T.take(["your keys", "your bag"]),
      T.thatsAll(), T.leavingOk(), T.keysCheck(), T.welcomeHome("Rose"), T.niceTime(), T.notYet(),
      T.medDue("your morning pills"), T.medIs("the white capsule"), T.medTaken("your morning pills", "five past eight"),
      T.medNextAt("eight o'clock in the evening"), T.medAtAppt("your noon pill", "Maple Grove Day Club"), T.medNoneToday(),
      T.medConfirmed("your morning pills"), T.medAlreadyTaken("your morning pills", "five past eight"), T.noMoreNow(),
      T.safeAtHome(), T.callOffer(carer), T.callRequested(carer), T.nightIs("ten past three"), T.nightSafe(),
      T.distressAck(carer), T.distressFollow(carer), T.systemError(carer), T.personIs("Tom", "son"), T.healthAsk(), T.askCarerFirst(carer),
    ];
  };
  it.each(["en-US", "de-DE"] as const)("every %s template is plain language", (locale) => {
    for (const s of all(locale, "Tom")) expect(checkPlain(s, locale), s).toMatchObject({ ok: true });
  });
  it("renders English exactly", () => {
    const T = templates("en-US");
    expect(T.leaveFor("Maple Grove Day Club", "twenty to ten")).toBe("You leave for Maple Grove Day Club at twenty to ten.");
    expect(T.medTaken("your morning pills", "five past eight")).toBe("You took your morning pills at five past eight.");
  });
  it("renders German exactly", () => {
    const T = templates("de-DE");
    expect(T.leaveFor("Tagesgruppe", "zwanzig vor zehn")).toBe("Tagesgruppe ist heute. Du gehst um zwanzig vor zehn los.");
    expect(T.take(["deinen Schlüssel", "deine Tasche"])).toBe("Nimm deinen Schlüssel und deine Tasche mit.");
    expect(T.medTaken("deine Morgentabletten", "fünf nach acht")).toBe("Du hast deine Morgentabletten um fünf nach acht genommen.");
  });
  it("unsure dose wording", () => {
    expect(templates("en-US").medUnsure("your noon pill")).toBe("I'm not sure if you had your noon pill yet.");
    expect(templates("en-US").askCarerFirst("Tom")).toBe("Let's ask Tom first.");
    expect(templates("de-DE").medUnsure("deine Mittagstablette")).toBe("Ich weiß nicht sicher, ob du deine Mittagstablette schon hattest.");
    expect(templates("de-DE").askCarerFirst("Tom")).toBe("Wir fragen zuerst Tom.");
  });
});

describe("roseDe", () => {
  it("is the German variant of Rose", () => {
    const p = roseDe();
    expect(p).toMatchObject({ id: "rose-de", locale: "de-DE", carerName: "Tom" });
    expect(p.appointments[0]!.weekdays).toEqual(rose().appointments[0]!.weekdays);
    expect(p.people[0]!.relationship).toBe("dein Sohn");
  });
  it("leaveAt does not name the appointment", () => {
    expect(templates("en-US").leaveAt("twenty to ten")).toBe("You leave at twenty to ten.");
    expect(templates("de-DE").leaveAt("zwanzig vor zehn")).toBe("Du gehst um zwanzig vor zehn los.");
  });
  it("German medAtAppt starts with the day", () => {
    expect(templates("de-DE").medAtAppt("deine Mittagstablette", "Tagesgruppe")).toBe("Heute bekommst du deine Mittagstablette dort: Tagesgruppe.");
  });
});

describe("rememberAsk", () => {
  it("follows a life-story topic with a yes/no question", () => {
    expect(templates("en-US").rememberAsk()).toBe("Do you remember that?");
    expect(templates("de-DE").rememberAsk()).toBe("Erinnerst du dich daran?");
  });
});

describe("Plan 2 templates", () => {
  it("en-US", () => {
    const T = templates("en-US");
    expect(T.listening()).toBe("I'm listening.");
    expect(T.musicStart("Ella Fitzgerald")).toBe("Here is some Ella Fitzgerald.");
    expect(T.weatherCold()).toBe("It's cold today. Wear your warm coat.");
    expect(T.weatherRain()).toBe("It may rain today. Take your umbrella.");
    expect(T.proMedAsk("your morning pills")).toBe("Have you taken your morning pills yet?");
    expect(T.proPrepAsk()).toBe("Shall I tell you what to take?");
    expect(T.proAreYouHome("Rose")).toBe("Are you back home, Rose?");
    expect(T.proBedtime("half past nine")).toBe("It's half past nine. Time to get ready for bed.");
    expect(T.proDoorAsk()).toBe("Is the front door locked?");
    expect(T.proMusicAsk("Ella Fitzgerald")).toBe("Shall I play some Ella Fitzgerald?");
    expect(T.proHello("Rose")).toBe("Hello, Rose.");
    expect(T.proChatAsk()).toBe("Shall we have a little chat?");
  });
  it("de-DE", () => {
    const T = templates("de-DE");
    expect(T.listening()).toBe("Ich höre zu.");
    expect(T.musicStart("Ella Fitzgerald")).toBe("Hier ist etwas von Ella Fitzgerald.");
    expect(T.weatherCold()).toBe("Heute ist es kalt. Zieh deinen warmen Mantel an.");
    expect(T.weatherRain()).toBe("Heute regnet es vielleicht. Nimm deinen Schirm mit.");
    expect(T.proMedAsk("deine Morgentabletten")).toBe("Hast du deine Morgentabletten schon genommen?");
    expect(T.proPrepAsk()).toBe("Soll ich dir sagen, was du mitnimmst?");
    expect(T.proAreYouHome("Rose")).toBe("Bist du wieder zu Hause, Rose?");
    expect(T.proBedtime("halb zehn")).toBe("Es ist halb zehn. Bald ist Schlafenszeit.");
    expect(T.proDoorAsk()).toBe("Ist die Haustür abgeschlossen?");
    expect(T.proMusicAsk("Ella Fitzgerald")).toBe("Soll ich etwas von Ella Fitzgerald spielen?");
    expect(T.proHello("Rose")).toBe("Hallo, Rose.");
    expect(T.proChatAsk()).toBe("Wollen wir ein bisschen plaudern?");
  });
});
