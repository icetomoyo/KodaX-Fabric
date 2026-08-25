import type { FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { employees, enterprises } from "../db/schema/index.js";
import { isSessionRole, verifySession, type SessionClaims } from "../lib/jwt.js";

function extractBearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1] ?? null;
}

export async function requireSession(req: FastifyRequest, reply: FastifyReply) {
  if (req.session && Number.isSafeInteger(req.employeeId) && req.employeeId! > 0) {
    return;
  }

  const token = extractBearer(req);
  if (!token) {
    return reply.code(401).send({ success: false, message: "未登录" });
  }
  let session: SessionClaims;
  try {
    session = await verifySession(token);
  } catch {
    return reply.code(401).send({ success: false, message: "登录已失效" });
  }

  const employeeId = Number(session.sub);
  if (!Number.isSafeInteger(employeeId) || employeeId <= 0) {
    return reply.code(401).send({ success: false, message: "登录已失效" });
  }

  const [user] = await db
    .select({
      id: employees.id,
      name: employees.name,
      phone: employees.phone,
      role: employees.role,
      status: employees.status,
      mustChangePassword: employees.mustChangePassword,
      enterpriseId: employees.enterpriseId,
      enterpriseStatus: enterprises.status,
    })
    .from(employees)
    .leftJoin(enterprises, eq(employees.enterpriseId, enterprises.id))
    .where(eq(employees.id, employeeId))
    .limit(1);

  if (!user || user.status !== "active") {
    return reply.code(401).send({ success: false, message: "用户不可用" });
  }

  if (!isSessionRole(user.role)) {
    return reply.code(401).send({ success: false, message: "登录已失效" });
  }

  if (
    (user.role === "org_admin" || user.role === "team_admin") &&
    (user.enterpriseId == null || user.enterpriseStatus !== "active")
  ) {
    return reply.code(401).send({ success: false, message: "用户不可用" });
  }

  if (
    user.role === "employee" &&
    user.enterpriseId != null &&
    user.enterpriseStatus === "disabled"
  ) {
    return reply.code(401).send({ success: false, message: "用户不可用" });
  }

  req.session = {
    sub: String(user.id),
    name: user.name,
    phone: user.phone,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    enterpriseId: user.enterpriseId,
  };
  req.employeeId = user.id;
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
