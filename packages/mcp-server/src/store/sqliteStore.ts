import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { CareEvent, EventType, Profile } from "@mia/shared";
import type { FieldCipher } from "./crypto";
import type { AlertInput, Severity, Store, StoredAlert } from "./store";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT NOT NULL,
  type TEXT NOT NULL, at TEXT NOT NULL, detail TEXT);
CREATE INDEX IF NOT EXISTS events_by_profile ON events (profile_id, at);
CREATE TABLE IF NOT EXISTS state (
  profile_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY (profile_id, key));
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, rule TEXT NOT NULL,
  severity TEXT NOT NULL, state TEXT NOT NULL, at TEXT NOT NULL, message TEXT NOT NULL);
`;

type Row = Record<string, string | number | null>;

/** Local-mode store. Everything except ids, types, timestamps and severities is encrypted. */
export class SqliteStore implements Store {
  private readonly db: DatabaseSync;

  constructor(path: string, private readonly cipher: FieldCipher) {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  async getProfile(id: string): Promise<Profile | null> {
    const row = this.db.prepare("SELECT data FROM profiles WHERE id = ?").get(id) as Row | undefined;
    return row ? (JSON.parse(await this.cipher.decrypt(String(row.data))) as Profile) : null;
  }

  async putProfile(p: Profile): Promise<void> {
    const data = await this.cipher.encrypt(JSON.stringify(p));
    this.db.prepare("INSERT INTO profiles (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data").run(p.id, data);
  }

  async addEvent(e: CareEvent): Promise<void> {
    const detail = e.detail ? await this.cipher.encrypt(JSON.stringify(e.detail)) : null;
    this.db.prepare("INSERT INTO events (profile_id, type, at, detail) VALUES (?, ?, ?, ?)").run(e.profileId, e.type, e.at, detail);
  }

  async eventsSince(profileId: string, sinceIso: string): Promise<CareEvent[]> {
    const rows = this.db.prepare("SELECT type, at, detail FROM events WHERE profile_id = ? AND at >= ? ORDER BY at, id").all(profileId, sinceIso) as Row[];
    return Promise.all(rows.map(async (r) => ({
      profileId,
      type: String(r.type) as EventType,
      at: String(r.at),
      ...(r.detail ? { detail: JSON.parse(await this.cipher.decrypt(String(r.detail))) as Record<string, string> } : {}),
    })));
  }

  async setLastSay(profileId: string, say: string[]): Promise<void> {
    const value = await this.cipher.encrypt(JSON.stringify(say));
    this.db.prepare("INSERT INTO state (profile_id, key, value) VALUES (?, 'lastSay', ?) ON CONFLICT(profile_id, key) DO UPDATE SET value = excluded.value").run(profileId, value);
  }

  async getLastSay(profileId: string): Promise<string[] | null> {
    const row = this.db.prepare("SELECT value FROM state WHERE profile_id = ? AND key = 'lastSay'").get(profileId) as Row | undefined;
    return row ? (JSON.parse(await this.cipher.decrypt(String(row.value))) as string[]) : null;
  }

  async addAlert(a: AlertInput): Promise<StoredAlert> {
    const stored: StoredAlert = { ...a, id: randomUUID(), state: "open" };
    this.db.prepare("INSERT INTO alerts (id, profile_id, rule, severity, state, at, message) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(stored.id, a.profileId, a.rule, a.severity, stored.state, a.at, await this.cipher.encrypt(a.message));
    return stored;
  }

  async listAlerts(profileId: string): Promise<StoredAlert[]> {
    const rows = this.db.prepare("SELECT * FROM alerts WHERE profile_id = ? ORDER BY at").all(profileId) as Row[];
    return Promise.all(rows.map(async (r) => ({
      id: String(r.id), profileId, rule: String(r.rule), severity: String(r.severity) as Severity,
      state: String(r.state) as StoredAlert["state"], at: String(r.at),
      message: await this.cipher.decrypt(String(r.message)),
    })));
  }

  /** Test helper: every stored value as one string, to prove nothing sensitive is in plaintext. */
  rawDump(): string {
    return ["profiles", "events", "state", "alerts"]
      .map((t) => JSON.stringify(this.db.prepare(`SELECT * FROM ${t}`).all()))
      .join("\n");
  }
}
