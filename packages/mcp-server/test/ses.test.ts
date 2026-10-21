import { describe, expect, it } from "vitest";
import { alertEmailOffWarning, maskEmail } from "../src/ses";

describe("alertEmailOffWarning (a public deploy without a mailer must not fail quietly)", () => {
  it("warns when Mia is public and no alert mailer is configured", () =>
    expect(alertEmailOffWarning({ MIA_PUBLIC_ORIGIN: "https://mia.example.com" }, false)).toMatch(/alert email OFF/));
  it("is quiet when a mailer is configured", () =>
    expect(alertEmailOffWarning({ MIA_PUBLIC_ORIGIN: "https://mia.example.com" }, true)).toBeNull());
  it.each([{}, { MIA_PUBLIC_ORIGIN: "" }, { MIA_PUBLIC_ORIGIN: "  " }])("is quiet locally: %j", (env) =>
    expect(alertEmailOffWarning(env, false)).toBeNull());
});

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
