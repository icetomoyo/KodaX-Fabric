import { SignJWT, jwtVerify } from "jose";
import { env } from "../config.js";

const secret = new TextEncoder().encode(env.JWT_SECRET);

export type SessionClaims = {
  sub: string;
  role: "employee" | "admin" | "auditor";
  phone: string;
  name: string;
  mustChangePassword: boolean;
};

export async function signSession(
  claims: SessionClaims,
  expiresIn = "7d",
): Promise<string> {
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
  return {
    sub: payload.sub,
    role: payload.role as SessionClaims["role"],
    phone: String(payload.phone ?? ""),
    name: String(payload.name ?? ""),
    mustChangePassword: Boolean(payload.mustChangePassword),
  };
}
