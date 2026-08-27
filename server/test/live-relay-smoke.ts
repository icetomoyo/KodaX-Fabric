/**
 * Explicit live smoke test. It creates one short-lived employee API key, calls
 * the locally running TokenHub API, verifies durable audits, then removes only
 * the key created by this process. Upstream response content and secrets are
 * never printed.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, sql } from "../src/db/client.js";
import {
  employeeApiKeys,
  employees,
  requestAudits,
} from "../src/db/schema/index.js";
import { encryptEmployeeApiKey, generateApiKey } from "../src/lib/api-key.js";

const baseUrl = process.env.TOKENHUB_SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const smokeModels = (process.env.TOKENHUB_SMOKE_MODELS ?? "glm-4.5-air,deepseek-v4-flash")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const smokeProductLineId = Number(process.env.TOKENHUB_SMOKE_PRODUCT_LINE_ID);
const label = `M2 live smoke ${randomUUID()}`;
const { raw, prefix, hash } = generateApiKey();
let createdKeyId: number | null = null;
const requestIds: string[] = [];

type SmokeResult = {
  model: string;
  stream: boolean;
  status: number;
  contentType: string;
  bytes: number;
  doneSeen: boolean | null;
  requestId: string | null;
  attempts: number;
};

async function waitForAudits(expected: number) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const rows = requestIds.length
      ? await db
          .select({
            requestId: requestAudits.requestId,
            providerCode: requestAudits.providerCode,
            status: requestAudits.status,
            totalTokens: requestAudits.totalTokens,
          })
          .from(requestAudits)
          .where(inArray(requestAudits.requestId, requestIds))
          .orderBy(asc(requestAudits.id))
      : [];
    if (rows.length >= expected) return rows;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return [];
}

async function callChat(model: string, stream: boolean): Promise<SmokeResult> {
  const response = await fetch(`${baseUrl}/ai/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${raw}`,
      "Content-Type": "application/json",
      "User-Agent": "TokenHub-M2-live-smoke",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with OK only." }],
      stream,
      max_tokens: 8,
      temperature: 0,
    }),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const requestId = response.headers.get("x-tokenhub-request-id");
  if (requestId) requestIds.push(requestId);
  const contentType = response.headers.get("content-type") ?? "";
  return {
    model,
    stream,
    status: response.status,
    contentType,
    bytes: bytes.byteLength,
    doneSeen: stream ? new TextDecoder().decode(bytes).includes("[DONE]") : null,
    requestId,
    attempts: 1,
  };
}

async function callChatWithRetry(model: string, stream: boolean): Promise<SmokeResult> {
  let last: SmokeResult | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    last = await callChat(model, stream);
    last.attempts = attempt;
    if (last.status === 200) return last;
    if (![429, 502, 503, 504].includes(last.status) || attempt === 3) return last;
    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
  return last!;
}

async function main() {
  assert(
    Number.isSafeInteger(smokeProductLineId) && smokeProductLineId > 0,
    "TOKENHUB_SMOKE_PRODUCT_LINE_ID must be a positive integer",
  );
  const [employee] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        eq(employees.role, "employee"),
        eq(employees.status, "active"),
        eq(employees.mustChangePassword, false),
      ),
    )
    .limit(1);
  assert(employee, "No active employee account is ready for a live relay smoke test");

  const [created] = await db
    .insert(employeeApiKeys)
    .values({
      employeeId: employee.id,
      name: label,
      keyPrefix: prefix,
      keyHash: hash,
      keyEncrypted: encryptEmployeeApiKey(raw),
      protocol: "openai_chat",
      productLineId: smokeProductLineId,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    })
    .returning({ id: employeeApiKeys.id });
  createdKeyId = created.id;

  const modelResponse = await fetch(`${baseUrl}/ai/models`, {
    headers: { Authorization: `Bearer ${raw}` },
  });
  assert.equal(modelResponse.status, 200, "GET /ai/models should succeed");
  const modelPayload = (await modelResponse.json()) as {
    data?: Array<{ id?: unknown }>;
  };
  const models = new Set(
    (modelPayload.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string"),
  );
  for (const model of smokeModels) {
    assert(models.has(model), `${model} is not routable`);
  }

  const results: SmokeResult[] = [];
  for (const model of smokeModels) {
    results.push(await callChatWithRetry(model, false));
    results.push(await callChatWithRetry(model, true));
  }

  for (const result of results) {
    assert.equal(result.status, 200, `${result.model} stream=${result.stream} failed`);
    assert(result.bytes > 0, `${result.model} returned an empty response`);
    if (result.stream) {
      assert(
        result.contentType.includes("text/event-stream"),
        `${result.model} did not return SSE`,
      );
      assert.equal(result.doneSeen, true, `${result.model} stream did not contain [DONE]`);
    } else {
      assert(
        result.contentType.includes("application/json"),
        `${result.model} did not return JSON`,
      );
    }
  }

  const audits = await waitForAudits(requestIds.length);
  assert.equal(audits.length, requestIds.length, "Relay audits were not persisted in time");
  const successfulRequestIds = new Set(
    audits.filter((item) => item.status === "success").map((item) => item.requestId),
  );
  assert(
    results.every(
      (result) => result.requestId && successfulRequestIds.has(result.requestId),
    ),
    "A final smoke request audit is not successful",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        models: results.map(({ model, stream, status, bytes, doneSeen, attempts }) => ({
          model,
          stream,
          status,
          bytes,
          doneSeen,
          attempts,
        })),
        audits,
      },
      null,
      2,
    ),
  );
}

try {
  await main();
} finally {
  if (createdKeyId !== null) {
    await db
      .delete(employeeApiKeys)
      .where(and(eq(employeeApiKeys.id, createdKeyId), eq(employeeApiKeys.name, label)));
  }
  await sql.end({ timeout: 5 });
}
