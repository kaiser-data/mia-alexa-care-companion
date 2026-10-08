import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface FieldCipher {
  encrypt(plain: string, aad?: string): Promise<string>;
  decrypt(token: string, aad?: string): Promise<string>;
}

/** AES-256-GCM with a local key file. Local mode only; AWS mode uses KMS (Plan 4). */
export class LocalAesCipher implements FieldCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("LocalAesCipher key must be 32 bytes");
  }

  async encrypt(plain: string, aad?: string): Promise<string> {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv, { authTagLength: 16 });
    if (aad !== undefined) c.setAAD(Buffer.from(aad, "utf8"));
    const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return `v1:${Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64")}`;
  }

  async decrypt(token: string, aad?: string): Promise<string> {
    if (!token.startsWith("v1:")) throw new Error("Unknown cipher format");
    const raw = Buffer.from(token.slice(3), "base64");
    if (raw.length < 28) throw new Error("Malformed ciphertext");
    const d = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12), { authTagLength: 16 });
    if (aad !== undefined) d.setAAD(Buffer.from(aad, "utf8"));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  }
}

export function loadOrCreateLocalKey(path: string): Buffer {
  if (existsSync(path)) return Buffer.from(readFileSync(path, "utf8").trim(), "base64");
  const key = randomBytes(32);
  writeFileSync(path, key.toString("base64"), { mode: 0o600, flag: "wx" });
  return key;
}
