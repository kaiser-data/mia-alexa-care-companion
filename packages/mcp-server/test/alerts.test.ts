import { describe, expect, it } from "vitest";
import { EmailAlertSink, type Mailer } from "../src/alerts";
import type { AlertInput } from "../src/store/store";

const a = (severity: AlertInput["severity"], rule = "med_unsure", message = "Rose is unsure about her pills."): AlertInput =>
  ({ profileId: "rose", rule, severity, message, at: "2026-10-20T08:00:00Z" });

function sink(o: { fail?: boolean } = {}) {
  const stored: AlertInput[] = [];
  const mails: { subject: string; text: string }[] = [];
  let t = Date.parse("2026-10-20T08:00:00Z");
  const mailer: Mailer = { send: async (m) => { if (o.fail) throw new Error("SES down"); mails.push(m); } };
  const s = new EmailAlertSink({ raise: async (x) => { stored.push(x); } }, mailer, { now: () => new Date(t) });
  return { s, stored, mails, later: (ms: number) => { t += ms; } };
}

describe("EmailAlertSink", () => {
  it("stores every alert and mails medium and high, not low", async () => {
    const { s, stored, mails } = sink();
    await s.raise(a("low"));
    await s.raise(a("medium"));
    await s.raise(a("high", "distress", "Rose asked for help."));
    expect(stored).toHaveLength(3);
    expect(mails.map((m) => m.subject)).toEqual(["[Mia] Rose is unsure about her pills.", "[Mia] URGENT: Rose asked for help."]);
    expect(mails[1]!.text).toContain("2026-10-20T08:00:00Z");
  });
  it("mails the same medium alert once per 6 hours; a cry for help every time", async () => {
    const { s, mails, later } = sink();
    await s.raise(a("medium"));
    await s.raise(a("medium"));
    later(6 * 3_600_000 + 1);
    await s.raise(a("medium"));
    await s.raise(a("high", "distress", "help"));
    await s.raise(a("high", "distress", "help"));
    expect(mails).toHaveLength(4);
  });
  it("a failed mail: high throws (she is told to call for help), medium does not; both are stored", async () => {
    const { s, stored } = sink({ fail: true });
    await expect(s.raise(a("medium"))).resolves.toBeUndefined();
    await expect(s.raise(a("high", "distress", "help"))).rejects.toThrow(/SES down/);
    expect(stored).toHaveLength(2);
  });
});
