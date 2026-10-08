import { randomBytes } from "node:crypto";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rose } from "@mia/shared";
import { LocalAesCipher, loadOrCreateLocalKey } from "../src/store/crypto";
import { SqliteStore } from "../src/store/sqliteStore";
import { StoreAlertSink } from "../src/alerts";

const newStore = () => new SqliteStore(":memory:", new LocalAesCipher(randomBytes(32)));

describe("LocalAesCipher", () => {
  it("round-trips and produces different ciphertext each time", async () => {
    const c = new LocalAesCipher(randomBytes(32));
    const a = await c.encrypt("the small white pill");
    const b = await c.encrypt("the small white pill");
    expect(a).not.toBe(b);
    expect(a.startsWith("v1:")).toBe(true);
    expect(await c.decrypt(a)).toBe("the small white pill");
  });
  it("rejects a wrong key", async () => {
    const token = await new LocalAesCipher(randomBytes(32)).encrypt("secret");
    await expect(new LocalAesCipher(randomBytes(32)).decrypt(token)).rejects.toThrow();
  });
  it("rejects keys that are not 32 bytes", () => {
    expect(() => new LocalAesCipher(randomBytes(16))).toThrow(/32 bytes/);
  });
  it("rejects tampered ciphertext", async () => {
    const c = new LocalAesCipher(randomBytes(32));
    const token = await c.encrypt("secret");
    const raw = Buffer.from(token.slice(3), "base64");
    raw[raw.length - 1] ^= 0xff;
    await expect(c.decrypt(`v1:${raw.toString("base64")}`)).rejects.toThrow();
  });
  it("rejects ciphertext moved to another row (AAD)", async () => {
    const c = new LocalAesCipher(randomBytes(32));
    const token = await c.encrypt("secret", "events:rose");
    await expect(c.decrypt(token, "events:other")).rejects.toThrow();
    expect(await c.decrypt(token, "events:rose")).toBe("secret");
  });
  it("rejects truncated ciphertext", async () => {
    await expect(new LocalAesCipher(randomBytes(32)).decrypt("v1:AAAA")).rejects.toThrow(/Malformed/);
  });
  it("creates the key file with mode 0600", () => {
    const path = join(mkdtempSync(join(tmpdir(), "mia-")), "local.key");
    loadOrCreateLocalKey(path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
  it("creates a key file once and reuses it", () => {
    const path = join(mkdtempSync(join(tmpdir(), "mia-")), "local.key");
    const k1 = loadOrCreateLocalKey(path);
    expect(loadOrCreateLocalKey(path).equals(k1)).toBe(true);
    expect(k1.length).toBe(32);
  });
});

describe("SqliteStore", () => {
  it("stores and loads a profile", async () => {
    const s = newStore();
    await s.putProfile(rose());
    expect(await s.getProfile("rose")).toEqual(rose());
    expect(await s.getProfile("nobody")).toBeNull();
  });
  it("returns events since an instant, oldest first", async () => {
    const s = newStore();
    await s.addEvent({ profileId: "rose", type: "anxious", at: "2026-10-12T20:00:00Z" });
    await s.addEvent({ profileId: "rose", type: "med_confirmed", at: "2026-10-12T12:05:00Z", detail: { medicationId: "morning-pills", doseTime: "08:00" } });
    await s.addEvent({ profileId: "other", type: "anxious", at: "2026-10-12T21:00:00Z" });
    const events = await s.eventsSince("rose", "2026-10-12T00:00:00Z");
    expect(events.map((e) => e.type)).toEqual(["med_confirmed", "anxious"]);
    expect(events[0]!.detail).toEqual({ medicationId: "morning-pills", doseTime: "08:00" });
  });
  it("remembers the last spoken answer", async () => {
    const s = newStore();
    expect(await s.getLastSay("rose")).toBeNull();
    await s.setLastSay("rose", ["Today is Monday."]);
    expect(await s.getLastSay("rose")).toEqual(["Today is Monday."]);
  });
  it("creates the database file with mode 0600", () => {
    const path = join(mkdtempSync(join(tmpdir(), "mia-")), "mia.db");
    new SqliteStore(path, new LocalAesCipher(randomBytes(32)));
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
  it("never stores sensitive text in plaintext", async () => {
    const s = newStore();
    await s.putProfile(rose());
    await s.addEvent({ profileId: "rose", type: "distress", at: "2026-10-12T12:00:00Z", detail: { what: "I fell in the kitchen" } });
    await s.addEvent({ profileId: "rose", type: "anxious", at: "2026-10-12T12:01:00Z" });
    await s.addEvent({ profileId: "rose", type: "med_confirmed", at: "2026-10-12T12:02:00Z" });
    await s.addEvent({ profileId: "rose", type: "call_requested", at: "2026-10-12T12:03:00Z" });
    await s.setLastSay("rose", ["You took your morning pills."]);
    await new StoreAlertSink(s).raise({ profileId: "rose", rule: "distress", severity: "high", message: "Rose asked for help", at: "2026-10-12T12:00:00Z" });
    const dump = s.rawDump();
    // only strings of 8+ chars: short ones could appear by chance inside base64 ciphertext
    for (const secret of ["Whitaker", "small white pill", "Linden Street", "I fell in the kitchen", "your morning pills", "Rose asked for help"]) {
      expect(dump).not.toContain(secret);
    }
    for (const word of ["distress", "anxious", "med_confirmed", "call_requested", "high"]) {
      expect(dump).not.toContain(word);
    }
  });
});

describe("StoreAlertSink", () => {
  it("stores raised alerts as open", async () => {
    const s = newStore();
    await new StoreAlertSink(s).raise({ profileId: "rose", rule: "call_requested", severity: "medium", message: "Rose would like a call.", at: "2026-10-12T15:00:00Z" });
    const alerts = await s.listAlerts("rose");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ rule: "call_requested", severity: "medium", state: "open", message: "Rose would like a call." });
  });
});
