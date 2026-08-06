/**
 * End-to-end native Responses and Anthropic Messages relay test.
 *
 * Uses only local PostgreSQL, Redis and a temporary node:http mock upstream.
 * All fixture rows and quota keys are removed in finally.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

process.env.RELAY_MAX_ATTEMPTS = "2";
process.env.RELAY_UPSTREAM_TIMEOUT_MS = "10000";

const [
  { buildApp },
  { db, sql },
  schema,
  { encryptEmployeeApiKey, generateApiKey },
  { encryptSecret, secretSuffix },
  { relayResponseAffinityKey },
  { redis },
] = await Promise.all([
  import("../src/app.js"),
  import("../src/db/client.js"),
  import("../src/db/schema/index.js"),
  import("../src/lib/api-key.js"),
  import("../src/lib/crypto-secret.js"),
  import("../src/lib/relay/response-affinity.js"),
  import("../src/redis.js"),
]);

const {
  credentialEmployeeGrants,
  employeeApiKeys,
  employees,
  modelRoutes,
  productLines,
  providers,
  requestAuditBodies,
  requestAudits,
  upstreamCredentials,
  usageCountersDaily,
} = schema;

type ProtocolName = "openai_responses" | "anthropic_messages";
type Fixture = {
  protocol: ProtocolName;
  clientModel: string;
  upstreamModel: string;
  employeeKey: string;
  upstreamSecret: string;
};

const runToken = randomUUID().replaceAll("-", "");
const marker = `native_${runToken.slice(0, 14)}`;
const employeePhone = `nv${runToken.slice(0, 16)}`;
const created = {
  employeeId: null as number | null,
  employeeApiKeyIds: [] as number[],
  providerIds: [] as number[],
  productLineIds: [] as number[],
  credentialIds: [] as number[],
  grantIds: [] as number[],
  routeIds: [] as number[],
};
const trackedRequestIds = new Set<string>();
const trackedRedisKeys = new Set<string>();
const mockFailures: string[] = [];
const fixtures = new Map<ProtocolName, Fixture>();

let app: FastifyInstance | null = null;
let upstream: Server | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function serverUrl(server: Server): string {
  const address = server.address();
  assert(address && typeof address !== "string");
  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return serverUrl(server);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  assert(isRecord(value), "mock upstream body must be an object");
  return value;
}

function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  const raw = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(raw)),
    ...headers,
  });
  res.end(raw);
}

function event(name: string, payload: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
}

async function sendEvents(res: ServerResponse, events: string[]): Promise<void> {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
  });
  for (const value of events) {
    res.write(value);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  res.end();
}

function requiredFixture(protocol: ProtocolName): Fixture {
  const fixture = fixtures.get(protocol);
  assert(fixture, `missing ${protocol} fixture`);
  return fixture;
}

async function handleResponses(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const fixture = requiredFixture("openai_responses");
  if (req.headers.authorization !== `Bearer ${fixture.upstreamSecret}`) {
    mockFailures.push("Responses upstream did not receive its Bearer credential");
  }
  if (req.headers["openai-beta"] !== "responses-test=v1") {
    mockFailures.push("Responses upstream did not receive openai-beta");
  }
  const body = await readJson(req);
  if (body.model !== fixture.upstreamModel) {
    mockFailures.push("Responses model mapping was not applied");
  }

  if (req.url === "/v1/responses/compact") {
    sendJson(res, 200, {
      id: "resp_compact_1",
      object: "response.compaction",
      output: [{ type: "compaction", encrypted_content: "local-mock" }],
      usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
    });
    return;
  }
  if (req.url !== "/v1/responses") {
    mockFailures.push(`unexpected Responses path ${req.url}`);
    sendJson(res, 404, { error: { message: "not found" } });
    return;
  }

  if (body.stream === true) {
    await sendEvents(res, [
      event("response.created", {
        type: "response.created",
        response: {
          id: "resp_stream_1",
          object: "response",
          model: fixture.upstreamModel,
          status: "in_progress",
          output: [],
        },
      }),
      event("response.output_text.delta", {
        type: "response.output_text.delta",
        item_id: "msg_1",
        output_index: 0,
        content_index: 0,
        delta: "native responses ok",
      }),
      event("response.completed", {
        type: "response.completed",
        response: {
          id: "resp_stream_1",
          object: "response",
          model: fixture.upstreamModel,
          status: "completed",
          output: [],
          usage: { input_tokens: 7, output_tokens: 5, total_tokens: 12 },
        },
      }),
    ]);
    return;
  }

  sendJson(
    res,
    200,
    {
      id: "resp_json_1",
      object: "response",
      model: fixture.upstreamModel,
      status: "completed",
      output: [
        {
          id: "msg_1",
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "native responses json ok" }],
        },
      ],
      usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
    },
    { "x-ratelimit-remaining-requests": "42", "x-request-id": "up_resp_1" },
  );
}

async function handleMessages(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const fixture = requiredFixture("anthropic_messages");
  if (req.headers["x-api-key"] !== fixture.upstreamSecret) {
    mockFailures.push("Messages upstream did not receive x-api-key credential");
  }
  if (req.headers.authorization !== undefined) {
    mockFailures.push("Messages upstream received the employee Authorization header");
  }
  if (req.headers["anthropic-version"] !== "2023-06-01") {
    mockFailures.push("Messages upstream did not receive anthropic-version");
  }
  if (req.headers["anthropic-beta"] !== "tokenhub-test-2026-08-04") {
    mockFailures.push("Messages upstream did not receive anthropic-beta");
  }
  if (
    req.url !== "/v1/messages" &&
    req.url !== "/v1/messages?beta=true" &&
    req.url !== "/v1/messages/count_tokens?beta=true"
  ) {
    mockFailures.push(`unexpected Messages path ${req.url}`);
  }
  const body = await readJson(req);
  if (body.model !== fixture.upstreamModel) {
    mockFailures.push("Messages model mapping was not applied");
  }
  if (req.url?.startsWith("/v1/messages/count_tokens")) {
    if (req.url !== "/v1/messages/count_tokens?beta=true") {
      mockFailures.push("Messages count_tokens beta query was not forwarded");
    }
    sendJson(res, 200, { input_tokens: 123 });
    return;
  }
  const forceOverload = JSON.stringify(body.messages).includes("force-overload");
  if (!forceOverload && body.stream !== true && req.url !== "/v1/messages?beta=true") {
    mockFailures.push("Messages beta query was not forwarded");
  }
  if (forceOverload) {
    sendJson(
      res,
      529,
      {
        type: "error",
        error: { type: "overloaded_error", message: "local mock overloaded" },
        request_id: "up_msg_overload",
      },
      { "retry-after": "7", "request-id": "up_msg_overload" },
    );
    return;
  }
  if (body.stream === true) {
    await sendEvents(res, [
      event("message_start", {
        type: "message_start",
        message: {
          id: "msg_stream_1",
          type: "message",
          role: "assistant",
          model: fixture.upstreamModel,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 8,
            cache_creation_input_tokens: 2,
            cache_read_input_tokens: 3,
            output_tokens: 1,
          },
        },
      }),
      event("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }),
      event("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "native messages ok" },
      }),
      event("content_block_stop", { type: "content_block_stop", index: 0 }),
      event("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 6 },
      }),
      event("message_stop", { type: "message_stop" }),
    ]);
    return;
  }

  sendJson(res, 200, {
    id: "msg_json_1",
    type: "message",
    role: "assistant",
    model: fixture.upstreamModel,
    content: [{ type: "text", text: "native messages json ok" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 4,
      cache_creation_input_tokens: 2,
      cache_read_input_tokens: 3,
      output_tokens: 5,
    },
  });
}

function createMockUpstream(): Server {
  return createServer((req, res) => {
    const handler = req.method === "POST" && req.url?.startsWith("/v1/responses")
      ? handleResponses
      : req.method === "POST" && req.url?.startsWith("/v1/messages")
        ? handleMessages
        : null;
    if (!handler) {
      mockFailures.push(`unexpected mock request ${req.method} ${req.url}`);
      sendJson(res, 404, { error: { message: "not found" } });
      return;
    }
    void handler(req, res).catch((error) => {
      mockFailures.push(error instanceof Error ? error.message : "mock handler failure");
      if (!res.headersSent) sendJson(res, 500, { error: { message: "mock failure" } });
      else if (!res.writableEnded) res.end();
    });
  });
}

async function insertFixtures(upstreamBaseUrl: string): Promise<void> {
  const [employee] = await db
    .insert(employees)
    .values({
      name: `Native Mock Employee ${marker}`,
      phone: employeePhone,
      passwordHash: "native-mock-password-not-used",
      dept: marker,
      role: "employee",
      status: "active",
      mustChangePassword: false,
    })
    .returning({ id: employees.id });
  created.employeeId = employee.id;

  for (const protocol of ["openai_responses", "anthropic_messages"] as const) {
    const tag = protocol === "openai_responses" ? "responses" : "messages";
    const clientModel = `${tag}-client-${marker}`;
    const upstreamModel = `${tag}-upstream-${marker}`;
    const generated = generateApiKey();
    const [provider] = await db
      .insert(providers)
      .values({
        code: `${tag}_${marker}`,
        name: `Native ${tag} Provider ${marker}`,
        defaultBaseUrl: protocol === "openai_responses"
          ? `${upstreamBaseUrl}/v1`
          : upstreamBaseUrl,
        authStyle: protocol === "openai_responses" ? "bearer" : "x-api-key",
        openaiCompatLevel: "full",
        status: "active",
      })
      .returning({ id: providers.id });
    created.providerIds.push(provider.id);

    const [line] = await db
      .insert(productLines)
      .values({
        providerId: provider.id,
        code: `${tag}_${marker}`,
        name: `Native ${tag} Line ${marker}`,
        productType: "api",
        shareMode: "grant_only",
        allowAutoRoute: false,
        status: "active",
      })
      .returning({ id: productLines.id });
    created.productLineIds.push(line.id);

    const [employeeKey] = await db
      .insert(employeeApiKeys)
      .values({
        employeeId: employee.id,
        name: `Native ${tag} key ${marker}`,
        keyPrefix: generated.prefix,
        keyHash: generated.hash,
        keyEncrypted: encryptEmployeeApiKey(generated.raw),
        protocol,
        productLineId: line.id,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      })
      .returning({ id: employeeApiKeys.id });
    created.employeeApiKeyIds.push(employeeKey.id);

    const upstreamSecret = `native_upstream_${tag}_${randomUUID().replaceAll("-", "")}`;
    const [credential] = await db
      .insert(upstreamCredentials)
      .values({
        productLineId: line.id,
        label: `Native ${tag} Credential ${marker}`,
        secretEncrypted: encryptSecret(upstreamSecret),
        secretSuffix: secretSuffix(upstreamSecret),
        supportedProtocols: [protocol],
        priority: 100,
        weight: 100,
        status: "active",
      })
      .returning({ id: upstreamCredentials.id });
    created.credentialIds.push(credential.id);

    const [grant] = await db
      .insert(credentialEmployeeGrants)
      .values({ credentialId: credential.id, employeeId: employee.id })
      .returning({ id: credentialEmployeeGrants.id });
    created.grantIds.push(grant.id);

    const [route] = await db
      .insert(modelRoutes)
      .values({
        clientModel,
        productLineId: line.id,
        upstreamModel,
        enabled: true,
        priority: 100,
        weight: 100,
      })
      .returning({ id: modelRoutes.id });
    created.routeIds.push(route.id);

    fixtures.set(protocol, {
      protocol,
      clientModel,
      upstreamModel,
      employeeKey: generated.raw,
      upstreamSecret,
    });
  }
}

function rememberQuotaKeys(): void {
  if (created.employeeId === null) return;
  trackedRedisKeys.add(
    `tokenhub:relay:rpm:${created.employeeId}:${Math.floor(Date.now() / 60_000)}`,
  );
  trackedRedisKeys.add(`tokenhub:relay:concurrency:v2:${created.employeeId}`);
}

async function call(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ response: Response; text: string; requestId: string | null }> {
  rememberQuotaKeys();
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  rememberQuotaKeys();
  const text = await response.text();
  const requestId = response.headers.get("x-tokenhub-request-id");
  if (requestId) trackedRequestIds.add(requestId);
  return { response, text, requestId };
}

async function waitForAudit(requestId: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const [row] = await db
      .select({
        protocol: requestAudits.protocol,
        isStream: requestAudits.isStream,
        status: requestAudits.status,
        totalTokens: requestAudits.totalTokens,
        requestHeaders: requestAuditBodies.requestHeaders,
        responseBody: requestAuditBodies.responseBody,
      })
      .from(requestAudits)
      .innerJoin(requestAuditBodies, eq(requestAuditBodies.requestId, requestAudits.requestId))
      .where(eq(requestAudits.requestId, requestId))
      .limit(1);
    if (row) return row;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`audit ${requestId} was not persisted`);
}

async function assertModels(baseUrl: string, fixture: Fixture): Promise<void> {
  const headers = fixture.protocol === "anthropic_messages"
    ? { "x-api-key": fixture.employeeKey }
    : { Authorization: `Bearer ${fixture.employeeKey}` };
  const response = await fetch(`${baseUrl}/ai/models`, { headers });
  assert.equal(response.status, 200);
  const requestId = response.headers.get("x-tokenhub-request-id");
  assert.match(requestId ?? "", /^threq_[a-f0-9]{32}$/);
  assert.equal(
    response.headers.get(
      fixture.protocol === "anthropic_messages" ? "request-id" : "x-request-id",
    ),
    requestId,
  );
  const payload = await response.json() as { data?: Array<{ id?: string }> };
  assert.deepEqual(payload.data?.map((item) => item.id), [fixture.clientModel]);
}

async function assertAnthropicModelsAuthErrors(
  baseUrl: string,
  fixture: Fixture,
): Promise<void> {
  const invalidResponse = await fetch(`${baseUrl}/ai/models`, {
    headers: { "x-api-key": `th_invalid_${marker}` },
  });
  const invalidBody = await invalidResponse.json() as {
    type?: string;
    request_id?: string;
    error?: { type?: string; code?: string };
  };
  const invalidRequestId = invalidResponse.headers.get("x-tokenhub-request-id");
  assert.equal(invalidResponse.status, 401);
  assert.equal(invalidBody.type, "error");
  assert.equal(invalidBody.error?.type, "authentication_error");
  assert.equal(invalidBody.error?.code, "invalid_api_key");
  assert.equal(invalidBody.request_id, invalidRequestId);
  assert.equal(invalidResponse.headers.get("request-id"), invalidRequestId);
  assert.equal(invalidResponse.headers.get("x-request-id"), null);

  assert(created.employeeId !== null);
  await db
    .update(employees)
    .set({ status: "disabled", updatedAt: new Date() })
    .where(eq(employees.id, created.employeeId));
  try {
    // A Bearer header alone is ambiguous before lookup. Once the Key is found,
    // its persisted Anthropic protocol must still select the native envelope.
    const disabledResponse = await fetch(`${baseUrl}/ai/models`, {
      headers: { Authorization: `Bearer ${fixture.employeeKey}` },
    });
    const disabledBody = await disabledResponse.json() as {
      type?: string;
      request_id?: string;
      error?: { code?: string };
    };
    const disabledRequestId = disabledResponse.headers.get("x-tokenhub-request-id");
    assert.equal(disabledResponse.status, 401);
    assert.equal(disabledBody.type, "error");
    assert.equal(disabledBody.error?.code, "invalid_api_key");
    assert.equal(disabledBody.request_id, disabledRequestId);
    assert.equal(disabledResponse.headers.get("request-id"), disabledRequestId);
    assert.equal(disabledResponse.headers.get("x-request-id"), null);
  } finally {
    await db
      .update(employees)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(employees.id, created.employeeId));
  }
}

async function runAssertions(baseUrl: string): Promise<void> {
  const responses = requiredFixture("openai_responses");
  const messages = requiredFixture("anthropic_messages");
  await assertModels(baseUrl, responses);
  await assertModels(baseUrl, messages);
  await assertAnthropicModelsAuthErrors(baseUrl, messages);

  const mismatchedResponses = await call(
    baseUrl,
    "/ai/responses",
    { Authorization: `Bearer ${messages.employeeKey}` },
    { model: responses.clientModel, input: "test" },
  );
  assert.equal(mismatchedResponses.response.status, 401);
  assert(isRecord(JSON.parse(mismatchedResponses.text).error));

  const mismatchedMessages = await call(
    baseUrl,
    "/ai/v1/messages",
    {
      Authorization: `Bearer ${responses.employeeKey}`,
      "anthropic-version": "2023-06-01",
    },
    { model: messages.clientModel, max_tokens: 32, messages: [{ role: "user", content: "x" }] },
  );
  assert.equal(mismatchedMessages.response.status, 401);
  const mismatchedMessagesBody = JSON.parse(mismatchedMessages.text) as {
    type?: string;
    request_id?: string;
    error?: { code?: string };
  };
  assert.equal(mismatchedMessagesBody.type, "error");
  assert.equal(mismatchedMessagesBody.error?.code, "invalid_api_key");
  assert.equal(mismatchedMessagesBody.request_id, mismatchedMessages.requestId);
  assert.equal(mismatchedMessages.response.headers.get("request-id"), mismatchedMessages.requestId);

  const missingVersion = await call(
    baseUrl,
    "/ai/v1/messages",
    { "x-api-key": messages.employeeKey },
    { model: messages.clientModel, max_tokens: 32, messages: [{ role: "user", content: "x" }] },
  );
  assert.equal(missingVersion.response.status, 400);
  assert.equal(
    (JSON.parse(missingVersion.text) as { error?: { type?: string; code?: string } }).error?.type,
    "invalid_request_error",
  );
  assert.equal(
    (JSON.parse(missingVersion.text) as { error?: { code?: string } }).error?.code,
    "invalid_request",
  );

  const malformedResponse = await fetch(`${baseUrl}/ai/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": messages.employeeKey,
      "anthropic-version": "2023-06-01",
    },
    body: "{",
  });
  const malformedText = await malformedResponse.text();
  const malformedRequestId = malformedResponse.headers.get("x-tokenhub-request-id");
  assert.equal(malformedResponse.status, 400);
  assert(malformedRequestId);
  trackedRequestIds.add(malformedRequestId);
  const malformedBody = JSON.parse(malformedText) as {
    type?: string;
    request_id?: string;
    error?: { type?: string; code?: string };
  };
  assert.equal(malformedBody.type, "error");
  assert.equal(malformedBody.error?.type, "invalid_request_error");
  assert.equal(malformedBody.error?.code, "invalid_request");
  assert.equal(malformedBody.request_id, malformedRequestId);
  assert.equal(malformedResponse.headers.get("request-id"), malformedRequestId);
  const malformedAudit = await waitForAudit(malformedRequestId);
  assert.equal(malformedAudit.protocol, "anthropic_messages");
  assert.equal(malformedAudit.status, "client_error");

  const responseJson = await call(
    baseUrl,
    "/ai/responses",
    {
      Authorization: `Bearer ${responses.employeeKey}`,
      "openai-beta": "responses-test=v1",
    },
    { model: responses.clientModel, input: "hello" },
  );
  assert.equal(responseJson.response.status, 200);
  assert.equal((JSON.parse(responseJson.text) as { object?: string }).object, "response");
  assert.equal(responseJson.response.headers.get("x-ratelimit-remaining-requests"), "42");
  assert.equal(responseJson.response.headers.get("x-tokenhub-upstream-request-id"), "up_resp_1");
  assert(responseJson.requestId);
  assert(created.employeeId !== null);
  trackedRedisKeys.add(relayResponseAffinityKey(created.employeeId, "resp_json_1"));

  const responseContinuation = await call(
    baseUrl,
    "/ai/responses",
    {
      Authorization: `Bearer ${responses.employeeKey}`,
      "openai-beta": "responses-test=v1",
    },
    {
      model: responses.clientModel,
      previous_response_id: "resp_json_1",
      input: "continue",
    },
  );
  assert.equal(responseContinuation.response.status, 200);
  assert(responseContinuation.requestId);

  const missingAffinity = await call(
    baseUrl,
    "/ai/responses",
    { Authorization: `Bearer ${responses.employeeKey}` },
    {
      model: responses.clientModel,
      previous_response_id: "resp_unknown",
      input: "continue",
    },
  );
  assert.equal(missingAffinity.response.status, 409);
  assert.equal(
    (JSON.parse(missingAffinity.text) as { error?: { code?: string } }).error?.code,
    "response_affinity_not_found",
  );

  const unsupportedBackground = await call(
    baseUrl,
    "/ai/responses",
    { Authorization: `Bearer ${responses.employeeKey}` },
    { model: responses.clientModel, input: "background", background: true },
  );
  assert.equal(unsupportedBackground.response.status, 400);

  const responseStream = await call(
    baseUrl,
    "/ai/responses",
    {
      Authorization: `Bearer ${responses.employeeKey}`,
      "openai-beta": "responses-test=v1",
    },
    { model: responses.clientModel, input: "stream", stream: true },
  );
  assert.equal(responseStream.response.status, 200);
  assert.match(responseStream.text, /event: response\.completed/);
  assert.equal(responseStream.text.includes("[DONE]"), false);
  assert(responseStream.requestId);
  trackedRedisKeys.add(relayResponseAffinityKey(created.employeeId, "resp_stream_1"));

  const compact = await call(
    baseUrl,
    "/ai/responses/compact",
    {
      Authorization: `Bearer ${responses.employeeKey}`,
      "openai-beta": "responses-test=v1",
    },
    { model: responses.clientModel, input: [{ role: "user", content: "compact" }] },
  );
  assert.equal(compact.response.status, 200);
  assert.equal((JSON.parse(compact.text) as { object?: string }).object, "response.compaction");
  assert(compact.requestId);

  const messageJson = await call(
    baseUrl,
    "/ai/v1/messages?beta=true",
    {
      "x-api-key": messages.employeeKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "tokenhub-test-2026-08-04",
    },
    {
      model: messages.clientModel,
      max_tokens: 64,
      messages: [{ role: "user", content: "hello" }],
    },
  );
  assert.equal(messageJson.response.status, 200);
  assert.equal((JSON.parse(messageJson.text) as { type?: string }).type, "message");
  assert.equal(messageJson.response.headers.get("request-id"), messageJson.requestId);
  assert(messageJson.requestId);

  const messageStream = await call(
    baseUrl,
    "/ai/v1/messages",
    {
      "x-api-key": messages.employeeKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "tokenhub-test-2026-08-04",
    },
    {
      model: messages.clientModel,
      max_tokens: 64,
      messages: [{ role: "user", content: "stream" }],
      stream: true,
    },
  );
  assert.equal(messageStream.response.status, 200);
  assert.match(messageStream.text, /event: message_stop/);
  assert(messageStream.requestId);

  const countTokens = await call(
    baseUrl,
    "/ai/v1/messages/count_tokens?beta=true",
    {
      "x-api-key": messages.employeeKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "tokenhub-test-2026-08-04",
    },
    {
      model: messages.clientModel,
      messages: [{ role: "user", content: "count this" }],
    },
  );
  assert.equal(countTokens.response.status, 200);
  assert.equal((JSON.parse(countTokens.text) as { input_tokens?: number }).input_tokens, 123);
  assert(countTokens.requestId);

  const messageOverload = await call(
    baseUrl,
    "/ai/v1/messages",
    {
      "x-api-key": messages.employeeKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "tokenhub-test-2026-08-04",
    },
    {
      model: messages.clientModel,
      max_tokens: 64,
      messages: [{ role: "user", content: "force-overload" }],
    },
  );
  assert.equal(messageOverload.response.status, 529);
  assert.equal(messageOverload.response.headers.get("retry-after"), "7");
  assert.equal(messageOverload.response.headers.get("request-id"), "up_msg_overload");
  assert.equal(
    messageOverload.response.headers.get("x-tokenhub-upstream-request-id"),
    "up_msg_overload",
  );
  assert.equal(
    (JSON.parse(messageOverload.text) as { error?: { type?: string } }).error?.type,
    "overloaded_error",
  );
  assert(messageOverload.requestId);

  const audited = await Promise.all([
    waitForAudit(responseJson.requestId),
    waitForAudit(responseContinuation.requestId),
    waitForAudit(responseStream.requestId),
    waitForAudit(compact.requestId),
    waitForAudit(messageJson.requestId),
    waitForAudit(messageStream.requestId),
    waitForAudit(countTokens.requestId),
    waitForAudit(messageOverload.requestId),
  ]);
  assert.deepEqual(
    audited.map((item) => item.protocol),
    [
      "openai_responses",
      "openai_responses",
      "openai_responses",
      "openai_responses",
      "anthropic_messages",
      "anthropic_messages",
      "anthropic_messages",
      "anthropic_messages",
    ],
  );
  assert.deepEqual(
    audited.map((item) => item.totalTokens),
    [7, 7, 12, 3, 14, 19, null, null],
  );
  assert.deepEqual(
    audited.map((item) => item.isStream),
    [false, false, true, false, false, true, false, false],
  );
  assert.deepEqual(
    audited.map((item) => item.status),
    [
      "success",
      "success",
      "success",
      "success",
      "success",
      "success",
      "success",
      "upstream_error",
    ],
  );
  for (const item of audited) {
    const serialized = JSON.stringify(item.requestHeaders);
    assert.equal(serialized.toLowerCase().includes("authorization"), false);
    assert.equal(serialized.toLowerCase().includes("x-api-key"), false);
  }
  for (const index of [2, 5]) {
    assert(isRecord(audited[index].responseBody));
    assert.equal(audited[index].responseBody.terminalSeen, true);
  }
  assert.deepEqual(mockFailures, []);

  console.log(JSON.stringify({
    ok: true,
    endpoints: [
      "/ai/responses",
      "/ai/responses/compact",
      "/ai/v1/messages",
      "/ai/v1/messages/count_tokens",
    ],
    modelIsolation: true,
    protocolBoundKeys: true,
    streamAudits: [audited[2].totalTokens, audited[5].totalTokens],
  }, null, 2));
}

async function deleteIds(
  ids: number[],
  remove: (uniqueIds: number[]) => Promise<unknown>,
): Promise<void> {
  if (ids.length > 0) await remove([...new Set(ids)]);
}

async function cleanup(): Promise<void> {
  if (redis.status === "ready" && trackedRedisKeys.size > 0) {
    await redis.del(...trackedRedisKeys);
  }
  if (created.employeeId !== null) {
    const rows = await db
      .select({ requestId: requestAudits.requestId })
      .from(requestAudits)
      .where(eq(requestAudits.employeeId, created.employeeId));
    for (const row of rows) trackedRequestIds.add(row.requestId);
  }
  if (trackedRequestIds.size > 0) {
    await db.delete(requestAuditBodies).where(inArray(requestAuditBodies.requestId, [...trackedRequestIds]));
  }
  if (created.employeeId !== null) {
    await db.delete(requestAudits).where(eq(requestAudits.employeeId, created.employeeId));
    await db.delete(usageCountersDaily).where(eq(usageCountersDaily.employeeId, created.employeeId));
  }
  await deleteIds(created.grantIds, (ids) =>
    db.delete(credentialEmployeeGrants).where(inArray(credentialEmployeeGrants.id, ids)));
  await deleteIds(created.employeeApiKeyIds, (ids) =>
    db.delete(employeeApiKeys).where(inArray(employeeApiKeys.id, ids)));
  await deleteIds(created.routeIds, (ids) =>
    db.delete(modelRoutes).where(inArray(modelRoutes.id, ids)));
  await deleteIds(created.credentialIds, (ids) =>
    db.delete(upstreamCredentials).where(inArray(upstreamCredentials.id, ids)));
  await deleteIds(created.productLineIds, (ids) =>
    db.delete(productLines).where(inArray(productLines.id, ids)));
  await deleteIds(created.providerIds, (ids) =>
    db.delete(providers).where(inArray(providers.id, ids)));
  if (created.employeeId !== null) {
    await db.delete(employees).where(
      and(eq(employees.id, created.employeeId), eq(employees.phone, employeePhone)),
    );
  }
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeIdleConnections();
  });
}

let primaryError: unknown = null;
try {
  assert.equal(await redis.ping(), "PONG");
  await sql`select 1`;
  upstream = createMockUpstream();
  const upstreamBaseUrl = await listen(upstream);
  await insertFixtures(upstreamBaseUrl);
  app = await buildApp();
  await app.listen({ host: "127.0.0.1", port: 0 });
  await runAssertions(serverUrl(app.server));
} catch (error) {
  primaryError = error;
} finally {
  const cleanupErrors: unknown[] = [];
  try {
    if (app) await app.close();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await closeServer(upstream);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await cleanup();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    if (redis.status !== "end") await redis.quit();
  } catch (error) {
    redis.disconnect();
    cleanupErrors.push(error);
  }
  try {
    await sql.end({ timeout: 5 });
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (primaryError) {
    throw cleanupErrors.length > 0
      ? new AggregateError([primaryError, ...cleanupErrors], "native relay test and cleanup failed")
      : primaryError;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "native relay integration cleanup failed");
  }
}
