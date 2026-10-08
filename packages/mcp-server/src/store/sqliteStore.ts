import { randomUUID } from "node:crypto";
import { chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { CareEvent, EventType, Profile } from "@mia/shared";
import type { FieldCipher } from "./crypto";
import type { AlertInput, Severity, Store, StoredAlert } from "./store";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT NOT NULL,
  at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_by_profile ON events (profile_id, at);
CREATE TABLE IF NOT EXISTS state (
  profile_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY (profile_id, key));
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, state TEXT NOT NULL,
  at TEXT NOT NULL, payload TEXT NOT NULL);
`;

type Row = Record<string, string | number | null>;

/** Local-mode store. Everything except ids, timestamps and alert state is encrypted, each value bound to its table and profile. */
export class SqliteStore implements Store {
  private readonly db: DatabaseSync;

  constructor(path: string, private readonly cipher: FieldCipher) {
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(SCHEMA);
  }

  private aad(table: string, profileId: string): string {
    return `${table}:${profileId}`;
  }

  async getProfile(id: string): Promise<Profile | null> {
    const row = this.db.prepare("SELECT data FROM profiles WHERE id = ?").get(id) as Row | undefined;
    return row ? (JSON.parse(await this.cipher.decrypt(String(row.data), this.aad("profiles", id))) as Profile) : null;
  }

  async putProfile(p: Profile): Promise<void> {
    const data = await this.cipher.encrypt(JSON.stringify(p), this.aad("profiles", p.id));
    this.db.prepare("INSERT INTO profiles (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data").run(p.id, data);
  }

  async addEvent(e: CareEvent): Promise<void> {
    const payload = await this.cipher.encrypt(JSON.stringify({ type: e.type, ...(e.detail ? { detail: e.detail } : {}) }), this.aad("events", e.profileId));
    this.db.prepare("INSERT INTO events (profile_id, at, payload) VALUES (?, ?, ?)").run(e.profileId, e.at, payload);
  }

  async eventsSince(profileId: string, sinceIso: string): Promise<CareEvent[]> {
    const rows = this.db.prepare("SELECT at, payload FROM events WHERE profile_id = ? AND at >= ? ORDER BY at, id").all(profileId, sinceIso) as Row[];
    return Promise.all(rows.map(async (r) => {
      const p = JSON.parse(await this.cipher.decrypt(String(r.payload), this.aad("events", profileId))) as { type: EventType; detail?: Record<string, string> };
      return { profileId, type: p.type, at: String(r.at), ...(p.detail ? { detail: p.detail } : {}) };
    }));
  }

  async setLastSay(profileId: string, say: string[]): Promise<void> {
    const value = await this.cipher.encrypt(JSON.stringify(say), this.aad("state", profileId));
    this.db.prepare("INSERT INTO state (profile_id, key, value) VALUES (?, 'lastSay', ?) ON CONFLICT(profile_id, key) DO UPDATE SET value = excluded.value").run(profileId, value);
  }

  async getLastSay(profileId: string): Promise<string[] | null> {
    const row = this.db.prepare("SELECT value FROM state WHERE profile_id = ? AND key = 'lastSay'").get(profileId) as Row | undefined;
    return row ? (JSON.parse(await this.cipher.decrypt(String(row.value), this.aad("state", profileId))) as string[]) : null;
  }

  async addAlert(a: AlertInput): Promise<StoredAlert> {
    const stored: StoredAlert = { ...a, id: randomUUID(), state: "open" };
    const payload = await this.cipher.encrypt(JSON.stringify({ rule: a.rule, severity: a.severity, message: a.message }), this.aad("alerts", a.profileId));
    this.db.prepare("INSERT INTO alerts (id, profile_id, state, at, payload) VALUES (?, ?, ?, ?, ?)")
      .run(stored.id, a.profileId, stored.state, a.at, payload);
    return stored;
  }

  async listAlerts(profileId: string): Promise<StoredAlert[]> {
    const rows = this.db.prepare("SELECT id, state, at, payload FROM alerts WHERE profile_id = ? ORDER BY at, id").all(profileId) as Row[];
    return Promise.all(rows.map(async (r) => {
      const p = JSON.parse(await this.cipher.decrypt(String(r.payload), this.aad("alerts", profileId))) as { rule: string; severity: Severity; message: string };
      return { id: String(r.id), profileId, rule: p.rule, severity: p.severity, state: String(r.state) as StoredAlert["state"], at: String(r.at), message: p.message };
    }));
  }

  /** Test helper: every stored value as one string, to prove nothing sensitive is in plaintext. */
  rawDump(): string {
    return ["profiles", "events", "state", "alerts"]
      .map((t) => JSON.stringify(this.db.prepare(`SELECT * FROM ${t}`).all()))
      .join("\n");
  }
}
