import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { employeeApiKeys, employees } from "../db/schema/index.js";
import { hashApiKey } from "../lib/api-key.js";
import {
  DEFAULT_RELAY_PROTOCOL,
  type RelayProtocol,
} from "../lib/relay/protocol.js";
import { isValidRelayProductLineId } from "../lib/relay/types.js";

function relayError(
  reply: FastifyReply,
  protocol: RelayProtocol,
  status: number,
  message: string,
  type: string,
  code: string,
) {
  const requestId = `threq_${randomUUID().replaceAll("-", "")}`;
  reply.header("x-tokenhub-request-id", requestId);
  if (protocol === "anthropic_messages") {
    reply.header("request-id", requestId);
    return reply.code(status).send({
      type: "error",
      error: { type, message, code },
      request_id: requestId,
    });
  }
  reply.header("x-request-id", requestId);
  return reply.code(status).send({
    error: { message, type, param: null, code },
  });
}

type RelayApiKeyHeaders = Record<string, string | string[] | undefined>;

export type RelayApiKeyExtraction =
  | { ok: true; key: string }
  | { ok: false; reason: "missing" | "malformed" | "conflict" };

function singleHeader(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value) && value.length === 1) return value[0]?.trim() || null;
  return null;
}

function extractBearer(value: string | string[] | undefined): string | null {
  const header = singleHeader(value);
  if (!header) return null;
  const match = /^Bearer\s+([^\s,]+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

export function extractRelayApiKey(
  headers: RelayApiKeyHeaders,
  protocol: RelayProtocol,
): RelayApiKeyExtraction {
  const authorizationPresent = headers.authorization !== undefined;
  const xApiKeyPresent = headers["x-api-key"] !== undefined;
  const bearerKey = extractBearer(headers.authorization);
  const xApiKey = singleHeader(headers["x-api-key"]);

  if ((authorizationPresent && !bearerKey) || (xApiKeyPresent && !xApiKey)) {
    return { ok: false, reason: "malformed" };
  }
  if (bearerKey && xApiKey && bearerKey !== xApiKey) {
    return { ok: false, reason: "conflict" };
  }

  const key = protocol === "anthropic_messages" ? (xApiKey ?? bearerKey) : bearerKey;
  return key ? { ok: true, key } : { ok: false, reason: "missing" };
}

/** Extract either supported client credential header before the Key protocol is known. */
export function extractAnyRelayApiKey(headers: RelayApiKeyHeaders): RelayApiKeyExtraction {
  return extractRelayApiKey(headers, "anthropic_messages");
}

function sendExtractionError(
  reply: FastifyReply,
  protocol: RelayProtocol,
  extracted: Extract<RelayApiKeyExtraction, { ok: false }>,
) {
  const message = extracted.reason === "conflict"
    ? "Authorization 与 x-api-key 不一致"
    : "无效的 TokenHub API Key";
  return relayError(
    reply,
    protocol,
    401,
    message,
    "authentication_error",
    extracted.reason === "conflict" ? "conflicting_api_key" : "invalid_api_key",
  );
}

async function authenticateRelayApiKey(
  req: FastifyRequest,
  reply: FastifyReply,
  rawKey: string,
  errorProtocol: RelayProtocol,
  expectedProtocol?: RelayProtocol,
) {
  if (!rawKey.startsWith("th_")) {
    return relayError(
      reply,
      errorProtocol,
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
      protocol: employeeApiKeys.protocol,
      productLineId: employeeApiKeys.productLineId,
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
        expectedProtocol ? eq(employeeApiKeys.protocol, expectedProtocol) : undefined,
        eq(employeeApiKeys.status, "active"),
        or(isNull(employeeApiKeys.expiresAt), gt(employeeApiKeys.expiresAt, new Date())),
      ),
    )
    .limit(1);

  if (
    !principal ||
    principal.employeeStatus !== "active" ||
    principal.employeeRole !== "employee" ||
    principal.mustChangePassword ||
    !isValidRelayProductLineId(principal.productLineId)
  ) {
    return relayError(
      reply,
      principal?.protocol ?? errorProtocol,
      401,
      "无效的 TokenHub API Key",
      "authentication_error",
      "invalid_api_key",
    );
  }

  req.relayPrincipal = {
    employeeId: principal.employeeId,
    employeeApiKeyId: principal.employeeApiKeyId,
    protocol: principal.protocol,
    productLineId: principal.productLineId,
    employeeName: principal.employeeName,
    employeePhone: principal.employeePhone,
    employeeDept: principal.employeeDept,
  };
}

export function createRequireRelayApiKey(expectedProtocol: RelayProtocol) {
  return async function requireRelayApiKeyForProtocol(
    req: FastifyRequest,
    reply: FastifyReply,
  ) {
    const extracted = extractRelayApiKey(req.headers, expectedProtocol);
    if (!extracted.ok) return sendExtractionError(reply, expectedProtocol, extracted);
    return authenticateRelayApiKey(req, reply, extracted.key, expectedProtocol, expectedProtocol);
  };
}

/** Chat Completions authentication hook. */
export const requireRelayApiKey = createRequireRelayApiKey(DEFAULT_RELAY_PROTOCOL);

/** Authenticate model discovery with any protocol-bound employee Key. */
export async function requireAnyRelayApiKey(req: FastifyRequest, reply: FastifyReply) {
  // Model discovery accepts every Key protocol. Before a Key can be resolved,
  // x-api-key is the only protocol signal available; after lookup,
  // authenticateRelayApiKey uses the persisted Key protocol for post-lookup
  // failures such as a disabled owner or corrupt binding.
  const errorProtocol = req.headers["x-api-key"] !== undefined
    ? "anthropic_messages"
    : DEFAULT_RELAY_PROTOCOL;
  const extracted = extractAnyRelayApiKey(req.headers);
  if (!extracted.ok) return sendExtractionError(reply, errorProtocol, extracted);
  return authenticateRelayApiKey(req, reply, extracted.key, errorProtocol);
}
