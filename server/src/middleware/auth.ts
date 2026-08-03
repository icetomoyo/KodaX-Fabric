import type { FastifyReply, FastifyRequest } from "fastify";
import { verifySession, type SessionClaims } from "../lib/jwt.js";

function extractBearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1] ?? null;
}

export async function requireSession(req: FastifyRequest, reply: FastifyReply) {
  const token = extractBearer(req);
  if (!token) {
    return reply.code(401).send({ success: false, message: "未登录" });
  }
  try {
    const session = await verifySession(token);
    req.session = session;
    req.employeeId = Number(session.sub);
  } catch {
    return reply.code(401).send({ success: false, message: "登录已失效" });
  }
}

export async function requirePasswordChanged(req: FastifyRequest, reply: FastifyReply) {
  if (req.session?.mustChangePassword) {
    return reply.code(403).send({
      success: false,
      code: "MUST_CHANGE_PASSWORD",
      message: "请先修改初始密码",
    });
  }
}

export function requireRoles(...roles: SessionClaims["role"][]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.session || !roles.includes(req.session.role)) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
  };
}
