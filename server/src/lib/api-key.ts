import { createHash, randomBytes } from "node:crypto";

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
