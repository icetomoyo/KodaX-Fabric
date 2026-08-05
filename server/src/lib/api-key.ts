import { createHash, randomBytes } from "node:crypto";
import { encryptSecret } from "./crypto-secret.js";

export const EMPLOYEE_API_KEY_ENCRYPTION_PURPOSE = "employee-api-key:v1";

const GENERATED_API_KEY_PATTERN = /^th_[A-Za-z0-9_-]{32}$/;

export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const raw = `th_${randomBytes(24).toString("base64url")}`;
  return {
    raw,
    prefix: raw.slice(0, 10),
    hash: hashApiKey(raw),
  };
}

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function isGeneratedApiKey(raw: string): boolean {
  return GENERATED_API_KEY_PATTERN.test(raw);
}

export function encryptEmployeeApiKey(raw: string): string {
  if (!isGeneratedApiKey(raw)) throw new Error("invalid employee API key format");
  return encryptSecret(raw, EMPLOYEE_API_KEY_ENCRYPTION_PURPOSE);
}
