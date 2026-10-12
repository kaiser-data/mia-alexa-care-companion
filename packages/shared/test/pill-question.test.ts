import { describe, expect, it } from "vitest";
import { detectPillQuestion } from "../src/i18n/pill-question";
import { detectPillQuestion as fromIndex } from "../src";

describe("detectPillQuestion", () => {
  it.each([
    "Should I take my pill now?", "Should I take my pills now", "Did I take my pills?", "did i take my tablets",
    "Have I had my pills today?", "Have I taken my medication?", "When is my pill?", "When is my next pill",
    "Is it time for my tablets?", "Which pill now?", "Do I need to take my medicine?", "What about my meds?",
    "Can I take my capsule now?", "Time for my pills?", "my pills?",
    "Soll ich jetzt meine Tablette nehmen?", "Soll ich meine Tabletten nehmen", "Habe ich meine Tabletten genommen?",
    "hab ich meine Morgentabletten schon genommen", "Wann kommt meine Tablette?", "Wann muss ich meine Medikamente nehmen",
    "Muss ich noch eine Pille nehmen?", "Welche Tablette jetzt?", "Ist es Zeit für meine Abendtablette?", "Meine Medikamente?",
  ])("a pill question: %j", (t) => expect(detectPillQuestion(t)).toBe(true));
  it.each([
    "I took my pill", "I took my pills this morning.", "I've had my tablets", "Done, I had them.",
    "Ich habe meine Tablette genommen", "Ich habe meine Tabletten schon genommen.", "ich hab die Medikamente genommen",
    "My pillow is too soft", "Is my pillow on the bed?", "Wo sind die Kaffeekapseln?", "I spilled my tea, is that bad?",
    "Is it time for lunch?", "Was gibt es heute zum Mittagessen?", "", "   ",
    // Something said before the question (a symptom, a yes) leaves the turn to the LLM, which may also alert Tom.
    "I feel dizzy, did I take my pills?", "Mir ist schwindelig, soll ich meine Tablette nehmen?", "Yes please, and when is my pill?",
  ])("not a pill question: %j", (t) => expect(detectPillQuestion(t)).toBe(false));
  it("is exported from @mia/shared", () => expect(fromIndex).toBe(detectPillQuestion));
});
