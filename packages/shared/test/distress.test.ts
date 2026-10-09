import { describe, expect, it } from "vitest";
import { detectDistress } from "../src/i18n/distress";

describe("detectDistress", () => {
  it.each([
    "I fell", "I fell in the kitchen", "help", "Help!", "help me", "please help", "I can't get up",
    "I can\u2019t get up", "I\u2019ve fallen", "my hip hurts", "call an ambulance", "I'm bleeding",
    "Hilfe!", "Ich bin gestürzt", "Ich bin hingefallen", "Mir tut der Rücken weh", "Ich komme nicht hoch", "Ruf den Notarzt",
    "ich komme nicht mehr hoch", "ich kann nicht mehr aufstehen", "ich bin gefallen", "meine Nase blutet", "Hilfe ich bin im Bad",
    "somebody help me I'm stuck", "I can't stand up", "I can't breathe", "I have chest pain", "I slipped in the bathroom",
  ])("detects %j", (t) => expect(detectDistress(t)).toBe(true));
  it.each([
    "Can you help me find my glasses please", "Did I take my pills?", "I fell asleep in my chair", "I fell in love with Frank in 1965", "Es hat mir gut gefallen", "help me find my glasses please",
    "What a help you are to me today", "Ich brauche Hilfe beim Kochen heute Abend", "Wann ist die Gruppe?", "", "   ",
  ])("ignores %j", (t) => expect(detectDistress(t)).toBe(false));
});
