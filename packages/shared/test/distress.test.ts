import { describe, expect, it } from "vitest";
import { detectDistress } from "../src/i18n/distress";

describe("detectDistress", () => {
  it.each([
    "I fell", "I fell in the kitchen", "help", "Help!", "help me", "please help", "I can't get up",
    "I can't get up", "my hip hurts", "call an ambulance", "I'm bleeding",
    "Hilfe!", "Ich bin gestürzt", "Ich bin hingefallen", "Mir tut der Rücken weh", "Ich komme nicht hoch", "Ruf den Notarzt",
  ])("detects %j", (t) => expect(detectDistress(t)).toBe(true));
  it.each([
    "Can you help me find my glasses please", "Did I take my pills?", "I fell asleep in my chair",
    "What a help you are to me today", "Ich brauche Hilfe beim Kochen heute Abend", "Wann ist die Gruppe?", "", "   ",
  ])("ignores %j", (t) => expect(detectDistress(t)).toBe(false));
});
