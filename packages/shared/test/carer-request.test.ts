import { describe, expect, it } from "vitest";
import { detectCarerOrHealthRequest } from "../src/i18n/carer-request";
import { detectCarerOrHealthRequest as fromIndex } from "../src";

describe("detectCarerOrHealthRequest", () => {
  it.each([
    // The carer is asked for
    "Call Tom", "Can Tom call me?", "I want Tom", "Where is Tom?", "Where’s Tom?", "I need to talk to Tom",
    "Ring Tom please", "Please get Tom", "Tom?", "Is Tom coming?", "I want to speak to Tom's wife", "Phone Tom for me",
    // A health or medicine question
    "I feel dizzy", "I feel sick", "I'm unwell", "Can I take an aspirin?", "Do I have a painkiller?", "Can I have some ibuprofen?",
    "My pills make me dizzy, should I take them?", "Is this medicine okay?", "I have a headache", "I've had my pills already",
    "I feel nauseous", "I think I have a fever", "My back aches",
  ])("en: detects %j", (t) => expect(detectCarerOrHealthRequest(t, "Tom")).toBe(true));
  it.each([
    "I can't sleep", "I can’t sleep", "Is it morning?", "Who is Frank?", "I'm bored", "What time is it?", "Tom is a good boy",
    "I had a bad dream", "Where am I?", "Is it time to get up?", "I'm cold", "Tomorrow is Wednesday", "My teacher was strict", "", "   ",
  ])("en: ignores %j", (t) => expect(detectCarerOrHealthRequest(t, "Tom")).toBe(false));
  it.each([
    // Der Betreuer wird gerufen
    "Tom soll mich anrufen", "Ich will Tom sprechen", "Ruf Tom an", "Wo ist Tom?", "Kann Tom mich anrufen?", "Ich möchte mit Tom reden",
    "Ich brauche Tom", "Hol Tom", "Tom?", "Kommt Tom?", "Ruf bitte Tom an", "Ich will mit Tom telefonieren",
    // Eine Gesundheits- oder Medikamentenfrage
    "Mir ist schwindelig", "Mir ist übel", "Ich habe Kopfschmerzen", "Darf ich eine Schmerztablette nehmen?", "Mein Medikament macht mich müde",
    "Mir ist schwindelig von den Tabletten", "Ich habe Fieber", "Mir ist schlecht", "Ich fühle mich krank", "Ich habe Bauchschmerzen", "Ich habe Kopfweh",
  ])("de: detects %j", (t) => expect(detectCarerOrHealthRequest(t, "Tom")).toBe(true));
  it.each([
    "Ich kann nicht schlafen", "Ist es schon Morgen?", "Wer ist Frank?", "Mir ist langweilig", "Wie spät ist es?",
    "Ich hatte einen schlechten Traum", "Wo bin ich?", "Mir ist kalt", "Tom ist ein guter Junge", "Ich bin müde", "Morgen ist Mittwoch", "Was soll ich machen?", "Ist die Katze verschwunden?",
  ])("de: ignores %j", (t) => expect(detectCarerOrHealthRequest(t, "Tom")).toBe(false));
  it("takes the carer's name from the profile", () => {
    expect(detectCarerOrHealthRequest("Call Anna", "Anna")).toBe(true);
    expect(detectCarerOrHealthRequest("Ruf Anna an", "Anna")).toBe(true);
    expect(detectCarerOrHealthRequest("Call Anna", "Tom")).toBe(false);
    expect(detectCarerOrHealthRequest("Call Tom", "")).toBe(false);
  });
  it("is exported from the package index", () => expect(fromIndex).toBe(detectCarerOrHealthRequest));
});
