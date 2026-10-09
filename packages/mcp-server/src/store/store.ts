import type { CareEvent, Profile } from "@mia/shared";

export type Severity = "low" | "medium" | "high";

export interface AlertInput {
  profileId: string;
  rule: string;
  severity: Severity;
  message: string;
  at: string;
}

export interface StoredAlert extends AlertInput {
  id: string;
  state: "open" | "acknowledged" | "resolved";
}

export interface Store {
  getProfile(id: string): Promise<Profile | null>;
  putProfile(p: Profile): Promise<void>;
  addEvent(e: CareEvent): Promise<void>;
  eventsSince(profileId: string, sinceIso: string): Promise<CareEvent[]>;
  setLastSay(profileId: string, say: string[]): Promise<void>;
  getLastSay(profileId: string): Promise<string[] | null>;
  addAlert(a: AlertInput): Promise<StoredAlert>;
  listAlerts(profileId: string): Promise<StoredAlert[]>;
}
