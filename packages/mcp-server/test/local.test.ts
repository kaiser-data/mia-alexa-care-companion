import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkDevToken, startLocalMia } from "../src/local";

describe("checkDevToken", () => {
  it.each([undefined, "", "short", "replace-with-a-long-random-string-of-24-plus-chars"])("rejects %j", (t) =>
    expect(() => checkDevToken(t)).toThrow(/MIA_DEV_TOKEN/));
  it("accepts a long random token", () => expect(checkDevToken("a".repeat(32))).toBe("a".repeat(32)));
});

describe("startLocalMia", () => {
  it("serves health on 127.0.0.1, seeds the profile, locks the data dir", async () => {
    const dataDir = join(mkdtempSync(join(tmpdir(), "mia-")), "data");
    const mia = await startLocalMia({ token: "t".repeat(32), profileId: "rose-de", dataDir, port: 0 });
    try {
      expect(mia.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(await (await fetch(`${mia.url}/health`)).json()).toEqual({ ok: true });
      expect(statSync(dataDir).mode & 0o777).toBe(0o700);
      expect(statSync(join(dataDir, "mia.db")).mode & 0o777).toBe(0o600);
    } finally {
      await mia.close();
    }
  });
});
