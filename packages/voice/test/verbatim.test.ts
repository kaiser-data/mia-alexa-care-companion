import { describe, expect, it } from "vitest";
import { enforceVerbatim } from "../src/verbatim";

const SAY = ["Not yet.", "Now it's time for your morning pills.", "That's the small white pill and the round pink one."];

describe("enforceVerbatim", () => {
  it("keeps one short warm lead-in before the template sentences", () => {
    expect(enforceVerbatim(`Of course, Rose. ${SAY.join(" ")}`, SAY, "en-US")).toEqual(["Of course, Rose.", ...SAY]);
  });
  it("drops a paraphrase and speaks the templates instead", () => {
    expect(enforceVerbatim("You should take your morning pills now, dear.", SAY, "en-US")).toEqual(SAY);
  });
  it("drops a long lead-in", () => {
    expect(enforceVerbatim(`Let me have a careful look at that for you. ${SAY.join(" ")}`, SAY, "en-US")).toEqual(SAY);
  });
  it("a lead-in that is itself a template sentence is not doubled", () => {
    expect(enforceVerbatim(SAY.join(" "), SAY, "en-US")).toEqual(SAY);
  });
  it("splits template entries that hold two sentences", () => {
    expect(enforceVerbatim("", ["Yes. You took your morning pills at five past eight."], "en-US"))
      .toEqual(["Yes.", "You took your morning pills at five past eight."]);
  });
  it("no templates: the LLM text is spoken, sentence by sentence", () => {
    expect(enforceVerbatim("That sounds lovely. Tell me more?", [], "en-US")).toEqual(["That sounds lovely.", "Tell me more?"]);
  });
  it("German ordinal dates stay whole", () => {
    expect(enforceVerbatim("", ["Heute ist Montag, der 12. Oktober."], "de-DE")).toEqual(["Heute ist Montag, der 12. Oktober."]);
  });
});
