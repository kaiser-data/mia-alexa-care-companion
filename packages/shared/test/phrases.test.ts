import { describe, expect, it } from "vitest";
import { checkPlain } from "../src/i18n/plain";
import { PHRASES, phraseIds, phraseText } from "../src/i18n/phrases";
import type { Locale } from "../src/domain/types";

const VARS = { name: "Rose", carer: "Tom" };
const LOCALES: Locale[] = ["en-US", "de-DE"];

describe("phrase catalogue", () => {
  it("every phrase is plain language in both locales", () => {
    for (const p of PHRASES) for (const l of LOCALES) {
      const t = phraseText(p.id, l, VARS)!;
      expect(checkPlain(t, l).ok, `${p.id} ${l}: ${t}`).toBe(true);
      expect(t).not.toMatch(/[{}]/);
    }
  });
  it("questions end with '?', all others with '.'", () => {
    for (const p of PHRASES) for (const t of [p.en, p.de]) {
      if (p.kind === "question") expect(t.endsWith("?"), t).toBe(true);
      else expect(t.endsWith("."), t).toBe(true);
    }
  });
  it("no phrase contains a digit", () => {
    for (const p of PHRASES) expect(`${p.en} ${p.de}`).not.toMatch(/\d/);
  });
  it("ids are unique", () => {
    expect(new Set(PHRASES.map((p) => p.id)).size).toBe(PHRASES.length);
  });
  it("unknown id → null", () => {
    expect(phraseText("nope", "en-US", VARS)).toBeNull();
  });
  it("fills name and carer", () => {
    expect(phraseText("offer_call", "de-DE", VARS)).toBe("Soll ich Tom um einen Anruf bitten?");
    expect(phraseText("of_course", "en-US", VARS)).toBe("Of course, Rose.");
  });
  it("lists the ids of one kind", () => {
    expect(phraseIds("closing")).toEqual(["sleep_well", "lovely_day", "lovely_evening"]);
    expect(phraseIds("opener")).toContain("of_course");
    expect(phraseIds("opener")).not.toContain("offer_call");
  });
});
