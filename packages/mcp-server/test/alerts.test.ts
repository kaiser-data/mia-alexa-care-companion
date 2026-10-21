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
  it("a mailer that never answers: high rejects after the timeout, medium returns at once; both are stored", async () => {
    const stored: AlertInput[] = [];
    const hung: Mailer = { send: () => new Promise<void>(() => {}) };
    const s = new EmailAlertSink({ raise: async (x) => { stored.push(x); } }, hung, { now: () => new Date(), timeoutMs: 20 });
    await expect(s.raise(a("medium"))).resolves.toBeUndefined();
    await expect(s.raise(a("high", "distress", "help"))).rejects.toThrow(/timed out/);
    expect(stored).toHaveLength(2);
  });
  it("a cry for help is mailed even when the store write fails, and does not throw (Tom got it)", async () => {
    const mails: { subject: string; text: string }[] = [];
    const brokenStore = { raise: async () => { throw new Error("database is locked"); } };
    const s = new EmailAlertSink(brokenStore, { send: async (m) => { mails.push(m); } }, { now: () => new Date() });
    await expect(s.raise(a("high", "distress", "help"))).resolves.toBeUndefined();
    expect(mails.map((m) => m.subject)).toEqual(["[Mia] URGENT: help"]);
  });
  it("a store that throws synchronously still lets the cry for help be mailed", async () => {
    const mails: { subject: string; text: string }[] = [];
    const brokenStore = { raise: (): Promise<void> => { throw new Error("disk full"); } };
    const s = new EmailAlertSink(brokenStore, { send: async (m) => { mails.push(m); } }, { now: () => new Date() });
    await expect(s.raise(a("high", "distress", "help"))).resolves.toBeUndefined();
    expect(mails).toHaveLength(1);
  });
  it("store fine, mail fails: the cry for help is stored and throws", async () => {
    const { s, stored } = sink({ fail: true });
    await expect(s.raise(a("high", "distress", "help"))).rejects.toThrow(/SES down/);
    expect(stored).toHaveLength(1);
  });
  it("store and mail both fail: the cry for help throws the mail error", async () => {
    const brokenStore = { raise: async () => { throw new Error("database is locked"); } };
    const s = new EmailAlertSink(brokenStore, { send: async () => { throw new Error("SES down"); } }, { now: () => new Date() });
    await expect(s.raise(a("high", "distress", "help"))).rejects.toThrow(/SES down/);
  });
  it("medium keeps its order: a failed store write throws and nothing is mailed", async () => {
    const mails: { subject: string; text: string }[] = [];
    const brokenStore = { raise: async () => { throw new Error("database is locked"); } };
    const s = new EmailAlertSink(brokenStore, { send: async (m) => { mails.push(m); } }, { now: () => new Date() });
    await expect(s.raise(a("medium"))).rejects.toThrow(/locked/);
    expect(mails).toHaveLength(0);
  });
  it("forgets dedupe entries older than 6 hours", async () => {
    const { s, mails, later } = sink();
    await s.raise(a("medium", "r1"));
    later(6 * 3_600_000 + 1);
    await s.raise(a("medium", "r2"));
    expect((s as unknown as { sent: Map<string, number> }).sent.size).toBe(1);
    expect(mails).toHaveLength(2);
  });
});
