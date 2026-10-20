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

export const MAIL_TIMEOUT_MS = 5000;

/**
 * Stores every alert, and mails medium and high ones to the carer. Every send is bounded by a timeout.
 * A cry for help (high) is awaited and throws when it cannot be mailed; medium is fire-and-forget (logged on failure).
 */
export class EmailAlertSink implements AlertSink {
  private readonly sent = new Map<string, number>();
  constructor(private readonly inner: AlertSink, private readonly mailer: Mailer, private readonly o: { now: () => Date; timeoutMs?: number }) {}
  private send(m: { subject: string; text: string }): Promise<void> {
    const ms = this.o.timeoutMs ?? MAIL_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`alert mail timed out after ${ms} ms`)), ms); });
    return Promise.race([this.mailer.send(m), timeout]).finally(() => clearTimeout(timer));
  }
  async raise(a: AlertInput): Promise<void> {
    await this.inner.raise(a);
    if (RANK[a.severity] < RANK.medium) return;
    const key = `${a.profileId}|${a.rule}|${a.message}`;
    const t = this.o.now().getTime();
    const last = this.sent.get(key);
    if (a.severity !== "high" && last !== undefined && t - last < MAIL_DEDUPE_MS) return;
    const mail = {
      subject: `[Mia] ${a.severity === "high" ? "URGENT: " : ""}${a.message}`,
      text: `${a.message}\n\nRule: ${a.rule}\nSeverity: ${a.severity}\nAt: ${a.at}\n\nSent by Mia (local mode, not production).`,
    };
    const done = () => {
      for (const [k, at] of this.sent) if (t - at >= MAIL_DEDUPE_MS) this.sent.delete(k);
      this.sent.set(key, t);
    };
    const failed = (err: unknown) => console.error(`[mia] alert mail failed (${a.severity}):`, err instanceof Error ? err.message : err);
    if (a.severity === "high") {
      try { await this.send(mail); done(); } catch (err) { failed(err); throw err; }
      return;
    }
    // Medium never holds her turn. The dedupe slot is taken at once so a repeat while in flight is not mailed twice.
    done();
    this.send(mail).catch((err) => { this.sent.delete(key); failed(err); });
  }
}
