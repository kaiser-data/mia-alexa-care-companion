import { describe, expect, it } from "vitest";
import { detectDistress } from "../src/i18n/distress";

describe("detectDistress", () => {
  it.each([
    "I fell", "I fell in the kitchen", "help", "Help!", "help me", "please help", "I can't get up",
    "I can\u2019t get up", "I\u2019ve fallen", "my hip hurts", "call an ambulance", "I'm bleeding",
    "Hilfe!", "Ich bin gestürzt", "Ich bin hingefallen", "Mir tut der Rücken weh", "Ich komme nicht hoch", "Ruf den Notarzt",
    "ich komme nicht mehr hoch", "ich kann nicht mehr aufstehen", "ich bin gefallen", "meine Nase blutet", "Hilfe ich bin im Bad",
    "somebody help me I'm stuck", "I can't stand up", "I can't breathe", "I have chest pain", "I slipped in the bathroom",
    "I took too many pills", "Ich habe zu viele Tabletten genommen", "Ich habe doppelt genommen",
  ])("detects %j", (t) => expect(detectDistress(t)).toBe(true));
  it.each([
    "Can you help me find my glasses please", "Did I take my pills?", "I fell asleep in my chair", "I fell in love with Frank in 1965", "Es hat mir gut gefallen", "help me find my glasses please",
    "What a help you are to me today", "Ich brauche Hilfe beim Kochen heute Abend", "Wann ist die Gruppe?", "", "   ",
  ])("ignores %j", (t) => expect(detectDistress(t)).toBe(false));
});

describe("pills taken twice is a possible emergency (M-5)", () => {
  it.each(["I took my pills twice", "I think I took my tablets twice", "took them twice",
    "Ich habe meine Tabletten zweimal genommen", "zweimal genommen", "doppelt genommen", "zu viele Tabletten"])("%s", (t) =>
    expect(detectDistress(t)).toBe(true));
  it.each(["Do I take my pills twice a day?", "Nehme ich die Tabletten zweimal am Tag?"])("a question about the plan is not: %s", (t) =>
    expect(detectDistress(t)).toBe(false));
});

describe("more ways to say pills taken twice (M-5 follow-up)", () => {
  it.each(["I took my tablet twice", "I took my medication twice", "I took the medicine twice", "I have taken them twice",
    "I have taken it twice", "I took my pills two times", "I took my tablets two times",
    "Ich habe sie zweimal eingenommen", "Ich habe sie doppelt eingenommen", "Ich habe die Tablette zweimal genommen",
    "Ich habe meine Tabletten zweimal genommen"])("%s", (t) => expect(detectDistress(t)).toBe(true));
  it.each(["Do I take my medicine twice a day?", "I take my tablet twice daily", "Nehme ich die Tablette zweimal täglich?",
    "Take my pills two times a day?", "Nehme ich die Tablette zweimal die Woche?", "Twice a week I go to the market",
    "Did I take my pills?", "Habe ich meine Tabletten genommen?"])("a plan question is not: %s", (t) =>
    expect(detectDistress(t)).toBe(false));
});

describe("pills taken twice in free word order (final review I1)", () => {
  it.each([
    "Ich habe heute zweimal meine Tabletten genommen", "Ich habe zweimal die Tabletten genommen", "Heute habe ich zweimal meine Medikamente eingenommen",
    "Ich habe die doppelte Dosis genommen", "doppelte Dosis", "Ich habe meine Tabletten noch mal genommen", "Ich habe meine Tabletten nochmal genommen",
    "Ich habe die Tabletten noch einmal genommen", "Ich glaube, ich habe sie noch mal genommen", "Ich habe meine Pillen zum zweiten Mal geschluckt",
    "I took my pills again", "I took my pills a second time", "I took twice my pills", "I think I've taken my tablets again",
    "I took my medicine one more time", "I swallowed my tablets a second time", "Oh no, I took the pills again this morning",
  ])("%s", (t) => expect(detectDistress(t)).toBe(true));
  it.each([
    "I take my pills twice a day", "Ich nehme meine Tabletten zweimal täglich", "Ich habe meine Tabletten immer zweimal am Tag genommen",
    "Should I take my pills again?", "When do I take my tablets a second time?", "Wann nehme ich meine Tabletten noch mal?",
    "Muss ich die Tabletten heute zweimal nehmen?", "I forgot my pills again", "Ich habe meine Tabletten schon wieder vergessen",
    "I haven't taken my pills again today", "Ich habe meine Tabletten heute nicht noch mal genommen", "Ich habe meine Tabletten noch nicht genommen",
    "I haven't taken my pills yet", "I took my pills and I will call Tom again later", "Ich habe heute wieder meine Tabletten genommen",
    "I took my pills", "Ich habe meine Tabletten genommen",
  ])("not an overdose: %s", (t) => expect(detectDistress(t)).toBe(false));
});

describe("the repeat word must belong to the taking, not to the next clause (fixes review I-A)", () => {
  it.each([
    "ich habe tabletten genommen und dann nochmal tom angerufen", "ich hab meine tabletten genommen und dann noch mal gefrühstückt",
    "ich habe die tabletten genommen ich frag nur nochmal", "nochmal ich habe meine tabletten genommen",
    "i took my pills and again i feel tired", "i took my pills i'll check again later", "I took my pills. I'll check again later.",
    "Ich habe die Tabletten genommen. Nochmal: wann kommt Tom?", "i took the dog out again after my pills",
    "i took my pills at eight and had breakfast again", "i took my medicine and then i took a nap again",
    "ich hab mir die tabletten nochmal angeschaut aber nicht genommen", "i had my tablets this morning and then i had lunch again",
  ])("not an overdose: %s", (t) => expect(detectDistress(t)).toBe(false));
  // Owner policy (controller decision): English "again" with a taken-verb about pills alarms, even as a daily report.
  it.each(["i took my pills again today", "i had my pills again this morning"])("accepted false alarm, pinned: %s", (t) =>
    expect(detectDistress(t)).toBe(true));
});

describe("too many of any pill word (fixes review I-C)", () => {
  it.each(["ich habe zu viele pillen genommen", "ich habe zu viele Medikamente genommen", "zu viele Tablette", "I took too many tablets",
    "too many medicines", "I've had too many meds", "I think that was too much medicine", "too many pills", "zu viele Pillen geschluckt"])("%s", (t) =>
    expect(detectDistress(t)).toBe(true));
});

describe("more overdose phrasings (review minors)", () => {
  it.each(["i took another dose", "i took an extra pill", "I've taken an extra tablet", "i took two lots of pills", "i took the whole box of pills",
    "ich habe die ganze packung genommen", "ich hab die ganze Schachtel geschluckt", "ich hab die tabletten schon wieder genommen",
    "ich habe noch eine tablette genommen"])("%s", (t) => expect(detectDistress(t)).toBe(true));
  it.each(["can i have another dose", "do i need an extra pill tonight", "i had another look at my pills", "i took my pills and had another cup of tea",
    "Ich habe heute wieder meine Tabletten genommen", "Soll ich noch eine Tablette nehmen?", "ich habe die tabletten schon wieder vergessen", "ich habe extra die tabletten genommen"])("not: %s", (t) =>
    expect(detectDistress(t)).toBe(false));
});

describe("English pronouns after the pill talk (fixes review I-B)", () => {
  it.each(["i took them again", "i took it again", "i swallowed them again", "i think i took them again this morning",
    "Oh, I took them again!", "i already took my pills and now i took them again", "i took my pills already and then i took them again",
    "i took my pills and then took them again", "I've taken them again"])("%s", (t) => expect(detectDistress(t)).toBe(true));
  it.each(["should i take them again", "i haven't taken them again", "zu viele Kekse", "i took it out again", "i took them to the shop again"])("not: %s", (t) =>
    expect(detectDistress(t)).toBe(false));
});

describe("words between the pronoun or participle and the repeat word (Codex review #1)", () => {
  it.each([
    "I took my pills and then took them once again", "I took my pills, then I took them once again", "i took them once again",
    "i took them all again", "i took them both again", "i took them all over again", "i swallowed them by mistake again", "i took it yet again",
    "Ich habe meine Tabletten genommen, schon wieder", "ich habe meine tabletten genommen nochmal", "Ich habe die Tabletten genommen, heute schon wieder",
    "Ich habe sie genommen, noch mal", "ich habe meine pillen eingenommen schon wieder",
  ])("%s", (t) => expect(detectDistress(t)).toBe(true));
  it.each([
    "ich habe meine tabletten genommen noch eine frage", "Ich habe meine Tabletten genommen und dann nochmal Tom angerufen",
    "i took it out again", "i took them to the shop again", "should i take them once again", "i haven't taken them once again",
    "Ich habe meine Tabletten genommen. Schon wieder regnet es.",
  ])("not: %s", (t) => expect(detectDistress(t)).toBe(false));
});

describe("ordinary modifiers inside the medication clause still alarm (Codex re-review #3)", () => {
  it.each([
    "I took them by accident again", "Ich habe meine Tabletten genommen, heute leider schon wieder",
    "I took them probably again", "I took them unfortunately once again", "I took them accidentally again today",
    "I've taken them by mistake once more", "I took them actually again",
    "Ich habe sie genommen, aus Versehen noch mal", "Ich habe meine Tabletten genommen, glaube ich, noch einmal",
    "Ich habe meine Tabletten zweimal glaube ich genommen", "Ich habe meine Tabletten genommen, wohl schon wieder",
    "Ich habe die Tabletten genommen, heute leider aus Versehen nochmal", "Ich habe meine Tabletten genommen, heute morgen schon wieder",
  ])("%s", (t) => expect(detectDistress(t)).toBe(true));
  it.each([
    "Ich habe meine Tabletten genommen und leider noch mal Tom angerufen", "I took my pills by accident and then I called Tom again",
    "Ich habe meine Tabletten leider nicht noch mal genommen", "I haven't actually taken them again", "Ich habe heute leider wieder meine Tabletten genommen",
  ])("not: %s", (t) => expect(detectDistress(t)).toBe(false));
});
