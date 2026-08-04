import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { employeeApiKeys, employees } from "../db/schema/index.js";
import { hashApiKey } from "../lib/api-key.js";

function relayError(
  reply: FastifyReply,
  status: number,
  message: string,
  type: string,
  code: string,
) {
  return reply.code(status).send({
    error: { message, type, param: null, code },
  });
}

function extractBearer(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

export async function requireRelayApiKey(req: FastifyRequest, reply: FastifyReply) {
  const rawKey = extractBearer(req);
  if (!rawKey || !rawKey.startsWith("th_")) {
    return relayError(
      reply,
      401,
      "无效的 TokenHub API Key",
      "authentication_error",
      "invalid_api_key",
    );
  }

  const [principal] = await db
    .select({
      employeeId: employees.id,
      employeeApiKeyId: employeeApiKeys.id,
      employeeName: employees.name,
      employeePhone: employees.phone,
      employeeDept: employees.dept,
      employeeStatus: employees.status,
      employeeRole: employees.role,
      mustChangePassword: employees.mustChangePassword,
    })
    .from(employeeApiKeys)
    .innerJoin(employees, eq(employeeApiKeys.employeeId, employees.id))
    .where(
      and(
        eq(employeeApiKeys.keyHash, hashApiKey(rawKey)),
        eq(employeeApiKeys.status, "active"),
        or(isNull(employeeApiKeys.expiresAt), gt(employeeApiKeys.expiresAt, new Date())),
      ),
    )
    .limit(1);

  if (
    !principal ||
    principal.employeeStatus !== "active" ||
    principal.employeeRole !== "employee" ||
    principal.mustChangePassword
  ) {
    return relayError(
      reply,
      401,
      "无效的 TokenHub API Key",
      "authentication_error",
      "invalid_api_key",
    );
  }

  req.relayPrincipal = {
    employeeId: principal.employeeId,
    employeeApiKeyId: principal.employeeApiKeyId,
    employeeName: principal.employeeName,
    employeePhone: principal.employeePhone,
    employeeDept: principal.employeeDept,
  };
}
