import type { AlertInput, Store } from "./store/store";

export interface AlertSink {
  raise(a: AlertInput): Promise<void>;
}

/** Persists alerts as open. Delivery (email/SMS ladder) is added in Plan 3. */
export class StoreAlertSink implements AlertSink {
  constructor(private readonly store: Store) {}
  async raise(a: AlertInput): Promise<void> {
    await this.store.addAlert(a);
  }
}
