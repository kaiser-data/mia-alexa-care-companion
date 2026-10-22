import type { AlertInput, Store } from "./store/store";

export interface AlertSink {
  raise(a: AlertInput): Promise<void>;
  /**
   * True when a resolved raise() of a medium or high alert means the carer was sent a message. False or missing: alerts
   * are only stored, so Mia must never say the carer was told.
   */
  readonly notifies?: boolean;
}

/** Persists alerts as open. Delivery: EmailAlertSink (SES). Alone it tells nobody. */
export class StoreAlertSink implements AlertSink {
  readonly notifies = false;
  constructor(private readonly store: Store) {}
  async raise(a: AlertInput): Promise<void> {
    await this.store.addAlert(a);
  }
}

export interface Mailer { send(m: { subject: string; text: string }): Promise<void> }

const RANK = { low: 0, medium: 1, high: 2 } as const;
export const MAIL_DEDUPE_MS = 6 * 3_600_000;

export const MAIL_TIMEOUT_MS = 5000;
export const MAIL_SUBJECT_MAX = 150;

/** Her words are in the subject: one line (no CR/LF or control characters, which SES may reject) and capped. The body keeps them whole. */
function mailSubject(s: string): string {
  return [...s.replace(/[\s\p{Cc}]+/gu, " ").trim()].slice(0, MAIL_SUBJECT_MAX).join("");
}

/**
 * Stores every alert, and mails medium and high ones to the carer. Every send is bounded by a timeout.
 * A cry for help (high) is awaited and throws when it cannot be mailed; medium is fire-and-forget (logged on failure).
 */
export class EmailAlertSink implements AlertSink {
  readonly notifies = true;
  private readonly sent = new Map<string, number>();
  constructor(private readonly inner: AlertSink, private readonly mailer: Mailer, private readonly o: { now: () => Date; timeoutMs?: number }) {}
  private send(m: { subject: string; text: string }): Promise<void> {
    const ms = this.o.timeoutMs ?? MAIL_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`alert mail timed out after ${ms} ms`)), ms); });
    return Promise.race([this.mailer.send(m), timeout]).finally(() => clearTimeout(timer));
  }
  async raise(a: AlertInput): Promise<void> {
    if (a.severity === "high") return this.raiseHigh(a);
    await this.inner.raise(a);
    if (RANK[a.severity] < RANK.medium) return;
    const key = `${a.profileId}|${a.rule}|${a.message}`;
    const t = this.o.now().getTime();
    const last = this.sent.get(key);
    if (last !== undefined && t - last < MAIL_DEDUPE_MS) return;
    const { mail, done, failed } = this.prepare(a, key, t);
    // Medium never holds her turn. The dedupe slot is taken at once so a repeat while in flight is not mailed twice.
    done();
    this.send(mail).catch((err) => { this.sent.delete(key); failed(err); });
  }
  /**
   * A cry for help: the store write and the mail run independently, so a broken database never stops the mail to the carer.
   * Throws only when the mail failed — that is what she must be told. A failed store write is logged.
   */
  private async raiseHigh(a: AlertInput): Promise<void> {
    const t = this.o.now().getTime();
    const { mail, done, failed } = this.prepare(a, `${a.profileId}|${a.rule}|${a.message}`, t);
    const [stored, mailed] = await Promise.allSettled([
      Promise.resolve().then(() => this.inner.raise(a)),
      Promise.resolve().then(() => this.send(mail)),
    ]);
    if (stored.status === "rejected") {
      const err = stored.reason;
      console.error("[mia] alert store failed (high):", err instanceof Error ? err.message : err);
    }
    if (mailed.status === "rejected") { failed(mailed.reason); throw mailed.reason; }
    done();
  }
  private prepare(a: AlertInput, key: string, t: number) {
    const mail = {
      subject: mailSubject(`[Mia] ${a.severity === "high" ? "URGENT: " : ""}${a.message}`),
      text: `${a.message}\n\nRule: ${a.rule}\nSeverity: ${a.severity}\nAt: ${a.at}\n\nSent by Mia (local mode, not production).`,
    };
    const done = () => {
      for (const [k, at] of this.sent) if (t - at >= MAIL_DEDUPE_MS) this.sent.delete(k);
      this.sent.set(key, t);
    };
    const failed = (err: unknown) => console.error(`[mia] alert mail failed (${a.severity}):`, err instanceof Error ? err.message : err);
    return { mail, done, failed };
  }
}
