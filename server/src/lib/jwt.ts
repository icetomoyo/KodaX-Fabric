import { SignJWT, jwtVerify } from "jose";
import { env } from "../config.js";

const secret = new TextEncoder().encode(env.JWT_SECRET);

export const SESSION_ROLES = ["employee", "admin"] as const;
export type SessionRole = (typeof SESSION_ROLES)[number];

const SESSION_ROLE_SET = new Set<string>(SESSION_ROLES);

export function isSessionRole(value: unknown): value is SessionRole {
  return typeof value === "string" && SESSION_ROLE_SET.has(value);
}

export type SessionClaims = {
  sub: string;
  role: SessionRole;
  phone: string;
  name: string;
  mustChangePassword: boolean;
};

export async function signSession(
  claims: SessionClaims,
  expiresIn = "7d",
): Promise<string> {
  if (!isSessionRole(claims.role)) {
    throw new Error("invalid role");
  }
  return new SignJWT({
    role: claims.role,
    phone: claims.phone,
    name: claims.name,
    mustChangePassword: claims.mustChangePassword,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}

export async function verifySession(token: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, secret);
  if (!payload.sub) throw new Error("invalid token");
  if (!isSessionRole(payload.role)) throw new Error("invalid role");
  return {
    sub: payload.sub,
    role: payload.role,
    phone: String(payload.phone ?? ""),
    name: String(payload.name ?? ""),
    mustChangePassword: Boolean(payload.mustChangePassword),
  };
}
