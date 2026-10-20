import type { AlertInput, Store } from "./store/store";

export interface AlertSink {
  raise(a: AlertInput): Promise<void>;
}

/** Persists alerts as open. Delivery: EmailAlertSink (SES). */
export class StoreAlertSink implements AlertSink {
  constructor(private readonly store: Store) {}
  async raise(a: AlertInput): Promise<void> {
    await this.store.addAlert(a);
  }
}

export interface Mailer { send(m: { subject: string; text: string }): Promise<void> }

const RANK = { low: 0, medium: 1, high: 2 } as const;
export const MAIL_DEDUPE_MS = 6 * 3_600_000;

/** Stores every alert, and mails medium and high ones to the carer. A cry for help that cannot be mailed throws. */
export class EmailAlertSink implements AlertSink {
  private readonly sent = new Map<string, number>();
  constructor(private readonly inner: AlertSink, private readonly mailer: Mailer, private readonly o: { now: () => Date }) {}
  async raise(a: AlertInput): Promise<void> {
    await this.inner.raise(a);
    if (RANK[a.severity] < RANK.medium) return;
    const key = `${a.profileId}|${a.rule}|${a.message}`;
    const t = this.o.now().getTime();
    const last = this.sent.get(key);
    if (a.severity !== "high" && last !== undefined && t - last < MAIL_DEDUPE_MS) return;
    try {
      await this.mailer.send({
        subject: `[Mia] ${a.severity === "high" ? "URGENT: " : ""}${a.message}`,
        text: `${a.message}\n\nRule: ${a.rule}\nSeverity: ${a.severity}\nAt: ${a.at}\n\nSent by Mia (local mode, not production).`,
      });
      this.sent.set(key, t);
    } catch (err) {
      console.error(`[mia] alert mail failed (${a.severity}):`, err instanceof Error ? err.message : err);
      if (a.severity === "high") throw err;
    }
  }
}
