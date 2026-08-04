import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { env } from "../config.js";

function keyBytes(purpose?: string): Buffer {
  const rootKey = createHash("sha256").update(env.CREDENTIAL_ENCRYPT_KEY).digest();
  if (purpose === undefined) return rootKey;
  if (purpose.length === 0) throw new Error("encryption purpose must not be empty");

  return createHmac("sha256", rootKey)
    .update("tokenhub:secret-purpose:v1\0", "utf8")
    .update(purpose, "utf8")
    .digest();
}

export function encryptSecret(plain: string, purpose?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(purpose), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(payload: string, purpose?: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(purpose), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function secretSuffix(plain: string): string {
  if (plain.length <= 4) return "****";
  return plain.slice(-4);
}
