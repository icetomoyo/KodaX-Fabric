import { SignJWT, jwtVerify } from "jose";
import { env } from "../config.js";

const secret = new TextEncoder().encode(env.JWT_SECRET);

export const SESSION_ROLES = ["employee", "admin", "org_admin", "dept_admin", "team_admin"] as const;
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
  enterpriseId: number | null;
};

export async function signSession(
  claims: SessionClaims,
  expiresIn = "7d",
): Promise<string> {
  if (!isSessionRole(claims.role)) {
    throw new Error("invalid role");
  }
  if (
    claims.enterpriseId != null &&
    (!Number.isSafeInteger(claims.enterpriseId) || claims.enterpriseId <= 0)
  ) {
    throw new Error("invalid enterprise");
  }
  return new SignJWT({
    role: claims.role,
    phone: claims.phone,
    name: claims.name,
    mustChangePassword: claims.mustChangePassword,
    enterpriseId: claims.enterpriseId,
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
  const rawEnterpriseId = payload.enterpriseId;
  const enterpriseId =
    rawEnterpriseId == null || rawEnterpriseId === "" ? null : Number(rawEnterpriseId);
  if (enterpriseId != null && (!Number.isSafeInteger(enterpriseId) || enterpriseId <= 0)) {
    throw new Error("invalid token");
  }
  return {
    sub: payload.sub,
    role: payload.role,
    phone: String(payload.phone ?? ""),
    name: String(payload.name ?? ""),
    mustChangePassword: Boolean(payload.mustChangePassword),
    enterpriseId,
  };
}
