import { describe, expect, it } from "vitest";
import { maskEmail } from "../src/ses";

describe("maskEmail (startup logs never show the carer's address)", () => {
  it.each([
    ["tom@example.com", "t***@example.com"],
    ["  tom.whitaker@example.org ", "t***@example.org"],
    ["t@example.com", "t***@example.com"],
    ["not-an-address", "***"],
    ["@example.com", "***@example.com"],
    ["", "***"],
    [undefined, "***"],
  ])("%j -> %s", (input, want) => expect(maskEmail(input)).toBe(want));
});
