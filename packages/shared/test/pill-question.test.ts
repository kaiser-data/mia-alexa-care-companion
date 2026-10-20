import { describe, expect, it } from "vitest";
import { detectPillQuestion } from "../src/i18n/pill-question";
import { detectPillQuestion as fromIndex } from "../src";

describe("detectPillQuestion", () => {
  it.each([
    "Should I take my pill now?", "Should I take my pills now", "Did I take my pills?", "did i take my tablets",
    "Did I take my pills this morning?", "Have I had my pills today?", "Have I taken my medication?", "When is my pill?",
    "When is my next pill", "When do I take my pills?", "Is it time for my tablets?", "Which pill now?",
    "Do I need to take my medicine?", "What about my meds?", "Can I take my capsule now?", "Time for my pills?", "my pills?",
    "Soll ich jetzt meine Tablette nehmen?", "Soll ich meine Tabletten nehmen", "Habe ich meine Tabletten genommen?",
    "hab ich meine Morgentabletten schon genommen?", "Habe ich heute schon meine Tabletten genommen?", "Wann kommt meine Tablette?",
    "Wann muss ich meine Medikamente nehmen", "Wann nehme ich meine Tabletten?", "Muss ich heute noch meine Tabletten nehmen?",
    "Muss ich jetzt meine Medizin nehmen?", "Welche Tablette jetzt?", "Ist es Zeit für meine Abendtablette?", "Meine Medikamente?",
  ])("a pill question: %j", (t) => expect(detectPillQuestion(t)).toBe(true));

  // The direct route is only for the plain, common question. Every doubt goes to the LLM, which can record a dose,
  // alert Tom or say "Let's ask Tom": a miss costs a few seconds, a wrong hit can prompt a double dose (C-1).
  it.each([
    // C-1: self-reports, in every tense and word order, with and without the subject (speech recognition drops "Ich").
    "I took my pill", "I took my pills this morning.", "I've had my tablets", "Done, I had them.", "Took my pills",
    "Had my pills already.", "Had my pills, yes", "Have taken my tablets", "Did take my pills this morning", "Done, had my pills",
    "I have taken my pills", "I did take my pills", "I'm taking my pills now", "I'll take my pills later", "I should take my pills",
    "My pills I took already", "Yes I had my pills", "Did my pills already",
    "Ich habe meine Tablette genommen", "Ich habe meine Tabletten schon genommen.", "ich hab die Medikamente genommen",
    "Hab meine Tabletten schon genommen", "Habe meine Tablette schon genommen.", "Hab grad meine Tabletten genommen",
    "Hab ich doch meine Tabletten genommen", "Hatte meine Tabletten schon", "Nehme jetzt meine Tablette",
    "Ich nehme jetzt meine Tablette", "Meine Tabletten habe ich schon genommen", "Die Tabletten hab ich genommen",
    "Gerade habe ich meine Tabletten genommen", "Ich soll meine Tabletten nehmen",
    // Verb-first with "ich" but no question mark is also a German statement ("[Die] hab ich schon genommen").
    "Hab ich meine Tabletten schon genommen", "hab ich meine Morgentabletten schon genommen",
    // I-1: a symptom or feeling, before or after the question, with or without a comma.
    "I feel dizzy, did I take my pills?", "Mir ist schwindelig, soll ich meine Tablette nehmen?",
    "Should I take a pill, I feel dizzy", "Did I take my pills? I feel sick.", "Should I take my pills I feel sick",
    "Should I take another pill, my heart is racing", "Muss ich eine Tablette nehmen, mir ist schwindelig?",
    "Soll ich meine Tabletten nehmen mir ist übel", "Soll ich eine Tablette nehmen, ich bin so müde",
    // I-1: painkillers and medicine that is not her own.
    "Kann ich eine Schmerztablette nehmen?", "Soll ich eine Kopfschmerztablette nehmen?", "Soll ich eine Schlaftablette nehmen?",
    "Can I take a pill for the pain?", "Should I take a headache tablet?", "Should I take a painkiller pill?",
    "Can I take a sleeping pill?", "Should I take an aspirin tablet?", "Soll ich eine Ibuprofen Tablette nehmen?",
    "Have I taken the wrong medicine?", "Habe ich die falschen Tabletten genommen?",
    // Someone else's pills.
    "Did Frank take his pills?", "Should Frank take his tablets?", "Hat Frank seine Tabletten genommen?",
    "Is it time for Frank's pills?", "Ist es Zeit für seine Tabletten?",
    // I-2: "tablet" the device.
    "Can Tom call me on my tablet?", "Where is my tablet?", "Is my tablet charged?", "Wo ist mein Tablet?",
    "Can you play music on my tablet?", "my tablet?", "Is it time for my tablet?", "Kannst du Musik auf dem Tablet spielen?",
    // I-2: compound questions and requests; the rest would be lost.
    "What day is it, and did I take my pills?", "Should I take my pills or call Tom?", "Is Tom coming, and did I take my pills?",
    "Did I take my pills and is Tom coming", "Did I take my pills. What day is it", "Yes please, and when is my pill?",
    "Soll ich meine Tabletten nehmen und Tom anrufen?", "Hab ich meine Tabletten genommen oder nicht?",
    "Soll ich meine Tabletten nehmen, aber ich habe schon gegessen?", "Mia, did I take my pills?",
    // Doubt about the dose itself: again, not, with food.
    "Should I take my pills again?", "Can I take my pills again now?", "Soll ich die Tabletten noch mal nehmen?",
    "Should I not take my pills?", "Should I take my pills with food?", "Muss ich meine Tabletten nicht nehmen?",
    // M-4: pill-like words that are not about her pills.
    "Is the medicine cabinet locked?", "Wo sind die Kapseln für die Kaffeemaschine?", "Wo sind die Kaffeekapseln?",
    "My pillow is too soft", "Is my pillow on the bed?", "I spilled my tea, is that bad?",
    "Is it time for lunch?", "Was gibt es heute zum Mittagessen?", "", "   ", "?",
    // I-3: another tablet ("noch eine", "noch 'ne", "noch einen", "noch mal") is a second dose: the LLM asks Tom.
    "Soll ich noch eine Tablette nehmen?", "Kann ich noch eine nehmen?", "Muss ich noch eine Pille nehmen?",
    "Soll ich noch 'ne Tablette nehmen?", "Soll ich noch einen Kapsel nehmen?", "Soll ich noch ne Tablette nehmen?",
    "can I take another one", "Can I take another pill?",
    // M-1: "tablet" (singular) is the device, even in a take-shape: "Soll ich mein Tablet nehmen?".
    "Soll ich mein Tablet nehmen?", "Muss ich mein Tablet nehmen?", "Should I take my tablet?", "Should I take my tablet now?",
    // Too long to be only the question.
    "Should I take my morning pills now or should I wait until later today?",
  ])("not a pill question: %j", (t) => expect(detectPillQuestion(t)).toBe(false));

  it("is exported from @mia/shared", () => expect(fromIndex).toBe(detectPillQuestion));
});
