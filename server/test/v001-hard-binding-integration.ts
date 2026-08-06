/**
 * Explicit v0.0.1 hard product-line binding integration test.
 *
 * This script uses the configured migrated PostgreSQL and Redis instances,
 * starts the real Fastify application, and talks only to a temporary local
 * node:http upstream. It is intentionally excluded from the default test
 * suite. Run it explicitly against an isolated development/test database:
 *
 *   npm run test:v001:binding --workspace=@tokenhub/server
 *
 * Every database fixture is uniquely tagged. Cleanup addresses only IDs
 * returned by this run and removes rows in foreign-key dependency order.
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

// Candidate ordering and retry behavior must be fixed before config.ts loads.
process.env.RELAY_MAX_ATTEMPTS = "3";
process.env.RELAY_UPSTREAM_TIMEOUT_MS = "10000";
process.env.RELAY_COOLDOWN_SECONDS = "30";

const [
  { buildApp },
  { db, sql },
  schema,
  { encryptEmployeeApiKey, generateApiKey },
  { encryptSecret, secretSuffix },
  { redis },
] = await Promise.all([
  import("../src/app.js"),
  import("../src/db/client.js"),
  import("../src/db/schema/index.js"),
  import("../src/lib/api-key.js"),
  import("../src/lib/crypto-secret.js"),
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

type Protocol = "openai_chat" | "anthropic_messages";
type Channel = "A" | "B";
type CredentialKind = "first" | "second" | "only";
type RetryTrap = "http_401" | "http_429" | "http_500" | "network";

type UpstreamIdentity = {
  channel: Channel;
  credential: CredentialKind;
};

type ApiResult = {
  status: number;
  text: string;
  headers: Headers;
  requestId: string;
};

type AuditRow = {
  requestId: string;
  protocol: Protocol;
  productLineId: number | null;
  credentialId: number | null;
  status: "success" | "upstream_error" | "client_error" | "cancelled";
  httpStatus: number | null;
  errorCode: string | null;
  retryCount: number;
};

const runId = randomUUID().replaceAll("-", "");
const marker = `v001bind_${runId.slice(0, 14)}`;
const employeePhone = `hb${runId.slice(0, 16)}`;
const sharedModel = `shared-client-${marker}`;
const bOnlyModel = `b-only-client-${marker}`;
const upstreamModelA = `upstream-a-${marker}`;
const upstreamModelB = `upstream-b-${marker}`;
const allProtocols: Protocol[] = [
  "openai_chat",
  "anthropic_messages",
];

const created = {
  employeeId: null as number | null,
  apiKeyIds: [] as number[],
  providerIds: [] as number[],
  productLineIds: [] as number[],
  credentialIds: [] as number[],
  routeIds: [] as number[],
  grantIds: [] as number[],
};

const productLineByChannel = new Map<Channel, number>();
const credentialIdByName = new Map<string, number>();
const employeeKeys = new Map<Protocol, string>();
const identityByAuthorization = new Map<string, UpstreamIdentity>();
const upstreamCalls: Array<UpstreamIdentity & { path: string; model: unknown }> = [];
const mockFailures: string[] = [];
const trackedRequestIds = new Set<string>();
const trackedRedisKeys = new Set<string>();

let app: FastifyInstance | null = null;
let upstream: Server | null = null;
let firstCredentialTrap: RetryTrap = "http_500";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireEmployeeId(): number {
  assert(created.employeeId !== null, "employee fixture is missing");
  return created.employeeId;
}

function requireProductLine(channel: Channel): number {
  const id = productLineByChannel.get(channel);
  assert(id, `product-line ${channel} fixture is missing`);
  return id;
}

function requireCredential(name: string): number {
  const id = credentialIdByName.get(name);
  assert(id, `credential ${name} fixture is missing`);
  return id;
}

function requireEmployeeKey(protocol: Protocol): string {
  const key = employeeKeys.get(protocol);
  assert(key, `employee ${protocol} key fixture is missing`);
  return key;
}

function serverUrl(server: Server): string {
  const address = server.address();
  assert(address && typeof address !== "string", "server has no TCP address");
  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return serverUrl(server);
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections();
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > 1024 * 1024) throw new Error("mock upstream request exceeded one MiB");
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks, size).toString("utf8")) as unknown;
  assert(isRecord(parsed), "mock upstream body must be a JSON object");
  return parsed;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const raw = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(raw)),
  });
  res.end(raw);
}

function successPayload(path: string): unknown {
  if (path === "/v1/chat/completions") {
    return {
      id: `chat_${marker}`,
      object: "chat.completion",
      created: 0,
      model: upstreamModelA,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "hard binding chat ok" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
    };
  }
  if (path === "/v1/messages") {
    return {
      id: `msg_${marker}`,
      type: "message",
      role: "assistant",
      model: upstreamModelA,
      content: [{ type: "text", text: "hard binding messages ok" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 7, output_tokens: 8 },
    };
  }
  if (path === "/v1/messages/count_tokens") {
    return { input_tokens: 19 };
  }
  return { error: { message: `unexpected mock path ${path}` } };
}

async function handleMock(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    mockFailures.push(`unexpected mock method ${req.method ?? "(missing)"}`);
    sendJson(res, 405, { error: { message: "method not allowed" } });
    return;
  }

  const authorization = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;
  const identity = authorization ? identityByAuthorization.get(authorization) : undefined;
  if (!identity) {
    mockFailures.push("mock upstream received an unknown or absent Authorization header");
    sendJson(res, 401, { error: { message: "unknown credential" } });
    return;
  }

  const body = await readJson(req);
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  upstreamCalls.push({ ...identity, path, model: body.model });

  const expectedModel = identity.channel === "A" ? upstreamModelA : upstreamModelB;
  if (body.model !== expectedModel) {
    mockFailures.push(
      `${identity.channel}/${identity.credential} received model ${String(body.model)}`,
    );
  }

  // A/first is deliberately retryable. Every protocol operation must retry
  // A/second without ever considering channel B.
  if (identity.channel === "A" && identity.credential === "first") {
    if (firstCredentialTrap === "network") {
      req.socket.destroy();
      return;
    }
    const status = firstCredentialTrap === "http_401"
      ? 401
      : firstCredentialTrap === "http_429"
        ? 429
        : 500;
    sendJson(res, status, {
      error: {
        type: "api_error",
        message: `intentional ${firstCredentialTrap} retry trap`,
      },
    });
    return;
  }

  if (identity.channel === "B") {
    // Return a valid payload so an isolation defect cannot hide behind an
    // upstream error; the call counter below remains the primary assertion.
    sendJson(res, 200, {
      ...((successPayload(path) as Record<string, unknown>) ?? {}),
      model: upstreamModelB,
      id: `unexpected_b_${marker}`,
    });
    return;
  }

  const payload = successPayload(path);
  if (isRecord(payload) && "error" in payload) mockFailures.push(`unexpected mock path ${path}`);
  sendJson(res, 200, payload);
}

function createMockUpstream(): Server {
  return createServer((req, res) => {
    void handleMock(req, res).catch((error) => {
      mockFailures.push(error instanceof Error ? error.message : "mock handler failed");
      if (!res.headersSent) sendJson(res, 500, { error: { message: "mock handler failed" } });
      else if (!res.writableEnded) res.end();
    });
  });
}

async function assertMigratedDatabase(): Promise<void> {
  const [state] = await sql<{
    productLineIdExists: boolean;
    productLineIdRequired: boolean;
  }[]>`
    select
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'employee_api_keys'
          and column_name = 'product_line_id'
      ) as "productLineIdExists",
      coalesce((
        select is_nullable = 'NO' from information_schema.columns
        where table_schema = 'public'
          and table_name = 'employee_api_keys'
          and column_name = 'product_line_id'
      ), false) as "productLineIdRequired"
  `;
  assert(state.productLineIdExists, "product_line_id is missing; migrate the isolated database first");
  assert(state.productLineIdRequired, "product_line_id must be NOT NULL");
}

async function insertCredential(
  productLineId: number,
  channel: Channel,
  credential: CredentialKind,
  priority: number,
): Promise<number> {
  const secret = `hard_binding_${channel.toLowerCase()}_${credential}_${runId}`;
  const [row] = await db
    .insert(upstreamCredentials)
    .values({
      productLineId,
      label: `${channel} ${credential} ${marker}`,
      secretEncrypted: encryptSecret(secret),
      secretSuffix: secretSuffix(secret),
      supportedProtocols: allProtocols,
      priority,
      weight: 100,
      status: "active",
    })
    .returning({ id: upstreamCredentials.id });
  created.credentialIds.push(row.id);
  credentialIdByName.set(`${channel}-${credential}`, row.id);
  identityByAuthorization.set(`Bearer ${secret}`, { channel, credential });
  return row.id;
}

async function insertFixtures(upstreamBaseUrl: string): Promise<void> {
  const [employee] = await db
    .insert(employees)
    .values({
      name: `Hard Binding Employee ${marker}`,
      phone: employeePhone,
      passwordHash: "hard-binding-integration-password-not-used",
      dept: marker,
      role: "employee",
      status: "active",
      mustChangePassword: false,
    })
    .returning({ id: employees.id });
  created.employeeId = employee.id;

  for (const channel of ["A", "B"] as const) {
    const [provider] = await db
      .insert(providers)
      .values({
        code: `hard_binding_${channel.toLowerCase()}_${marker}`,
        name: `Hard Binding Provider ${channel} ${marker}`,
        defaultBaseUrl: `${upstreamBaseUrl}/v1`,
        authStyle: "bearer",
        openaiCompatLevel: "full",
        status: "active",
      })
      .returning({ id: providers.id });
    created.providerIds.push(provider.id);

    const [line] = await db
      .insert(productLines)
      .values({
        providerId: provider.id,
        code: `hard_binding_${channel.toLowerCase()}_${marker}`,
        name: `Hard Binding Channel ${channel} ${marker}`,
        productType: "api",
        shareMode: "public_pool",
        allowAutoRoute: false,
        status: "active",
      })
      .returning({ id: productLines.id });
    created.productLineIds.push(line.id);
    productLineByChannel.set(channel, line.id);

    if (channel === "A") {
      await insertCredential(line.id, channel, "first", 200);
      await insertCredential(line.id, channel, "second", 100);
    } else {
      await insertCredential(line.id, channel, "only", 300);
    }

    const [sharedRoute] = await db
      .insert(modelRoutes)
      .values({
        clientModel: sharedModel,
        productLineId: line.id,
        upstreamModel: channel === "A" ? upstreamModelA : upstreamModelB,
        enabled: true,
        priority: channel === "A" ? 100 : 300,
        weight: 100,
      })
      .returning({ id: modelRoutes.id });
    created.routeIds.push(sharedRoute.id);

    if (channel === "B") {
      const [bOnlyRoute] = await db
        .insert(modelRoutes)
        .values({
          clientModel: bOnlyModel,
          productLineId: line.id,
          upstreamModel: `upstream-b-only-${marker}`,
          enabled: true,
          priority: 300,
          weight: 100,
        })
        .returning({ id: modelRoutes.id });
      created.routeIds.push(bOnlyRoute.id);
    }
  }

  const productLineA = requireProductLine("A");
  for (const protocol of allProtocols) {
    const generated = generateApiKey();
    const [row] = await db
      .insert(employeeApiKeys)
      .values({
        employeeId: employee.id,
        name: `Hard Binding ${protocol} ${marker}`,
        keyPrefix: generated.prefix,
        keyHash: generated.hash,
        keyEncrypted: encryptEmployeeApiKey(generated.raw),
        protocol,
        productLineId: productLineA,
        status: "active",
        expiresAt: new Date(Date.now() + 30 * 60_000),
      })
      .returning({ id: employeeApiKeys.id });
    created.apiKeyIds.push(row.id);
    employeeKeys.set(protocol, generated.raw);
  }
}

function protocolHeaders(protocol: Protocol): Record<string, string> {
  const key = requireEmployeeKey(protocol);
  if (protocol === "anthropic_messages") {
    return {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    };
  }
  return { authorization: `Bearer ${key}` };
}

function rememberQuotaKeys(): void {
  if (created.employeeId === null) return;
  trackedRedisKeys.add(
    `tokenhub:relay:rpm:${created.employeeId}:${Math.floor(Date.now() / 60_000)}`,
  );
  trackedRedisKeys.add(`tokenhub:relay:concurrency:v2:${created.employeeId}`);
}

async function callApi(
  baseUrl: string,
  path: string,
  protocol: Protocol,
  body: unknown,
): Promise<ApiResult> {
  rememberQuotaKeys();
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...protocolHeaders(protocol),
    },
    body: JSON.stringify(body),
  });
  rememberQuotaKeys();
  const text = await response.text();
  const requestId = response.headers.get("x-tokenhub-request-id");
  assert(requestId, `${path} omitted x-tokenhub-request-id`);
  trackedRequestIds.add(requestId);
  return { status: response.status, text, headers: response.headers, requestId };
}

function errorCode(result: ApiResult): string | undefined {
  const body = JSON.parse(result.text) as unknown;
  return isRecord(body) && isRecord(body.error) && typeof body.error.code === "string"
    ? body.error.code
    : undefined;
}

function countCalls(channel: Channel, credential?: CredentialKind): number {
  return upstreamCalls.filter(
    (call) => call.channel === channel && (credential === undefined || call.credential === credential),
  ).length;
}

function assertChannelBWasNeverCalled(context: string): void {
  assert.equal(countCalls("B"), 0, `channel B was called during ${context}`);
}

async function assertBoundModelLists(baseUrl: string): Promise<void> {
  for (const protocol of allProtocols) {
    const response = await fetch(`${baseUrl}/ai/models`, {
      headers: protocolHeaders(protocol),
    });
    assert.equal(response.status, 200, `${protocol} /ai/models failed`);
    const requestId = response.headers.get("x-tokenhub-request-id");
    assert.match(requestId ?? "", /^threq_[a-f0-9]{32}$/);
    assert.equal(
      response.headers.get(protocol === "anthropic_messages" ? "request-id" : "x-request-id"),
      requestId,
    );
    const payload = await response.json() as { data?: Array<{ id?: string }> };
    const ids = payload.data?.map((item) => item.id) ?? [];
    assert.deepEqual(ids, [sharedModel], `${protocol} model list escaped channel A`);
    assert.equal(ids.includes(bOnlyModel), false, `${protocol} exposed B-only model`);
  }
  assertChannelBWasNeverCalled("model discovery");
}

async function waitForAudit(requestId: string): Promise<AuditRow> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const [row] = await db
      .select({
        requestId: requestAudits.requestId,
        protocol: requestAudits.protocol,
        productLineId: requestAudits.productLineId,
        credentialId: requestAudits.credentialId,
        status: requestAudits.status,
        httpStatus: requestAudits.httpStatus,
        errorCode: requestAudits.errorCode,
        retryCount: requestAudits.retryCount,
      })
      .from(requestAudits)
      .where(eq(requestAudits.requestId, requestId))
      .limit(1);
    if (row) return row;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`request audit ${requestId} was not persisted`);
}

async function assertProtocolEntrypoints(baseUrl: string): Promise<ApiResult[]> {
  firstCredentialTrap = "http_500";
  const chat = await callApi(
    baseUrl,
    "/ai/chat/completions",
    "openai_chat",
    {
      model: sharedModel,
      messages: [{ role: "user", content: "hard binding chat" }],
      stream: false,
    },
  );
  assert.equal(chat.status, 200);
  assert.equal((JSON.parse(chat.text) as { model?: string }).model, upstreamModelA);

  const messages = await callApi(
    baseUrl,
    "/ai/v1/messages",
    "anthropic_messages",
    {
      model: sharedModel,
      max_tokens: 64,
      messages: [{ role: "user", content: "hard binding messages" }],
    },
  );
  assert.equal(messages.status, 200);
  const messagesBody = JSON.parse(messages.text) as { type?: string; model?: string };
  assert.equal(messagesBody.type, "message");
  assert.equal(messagesBody.model, upstreamModelA);

  const countTokens = await callApi(
    baseUrl,
    "/ai/v1/messages/count_tokens",
    "anthropic_messages",
    {
      model: sharedModel,
      messages: [{ role: "user", content: "count hard binding" }],
    },
  );
  assert.equal(countTokens.status, 200);
  assert.equal((JSON.parse(countTokens.text) as { input_tokens?: number }).input_tokens, 19);

  assert.equal(countCalls("A", "first"), 3, "A/first did not receive all retry traps");
  assert.equal(countCalls("A", "second"), 3, "A/second did not complete all retries");
  assertChannelBWasNeverCalled("the protocol entrypoints");
  assert.deepEqual(mockFailures, [], "local mock upstream observed invalid relay requests");

  const audits = await Promise.all(
    [chat, messages, countTokens].map((result) =>
      waitForAudit(result.requestId)),
  );
  for (const audit of audits) {
    assert.equal(audit.status, "success");
    assert.equal(audit.httpStatus, 200);
    assert.equal(audit.productLineId, requireProductLine("A"));
    assert.equal(audit.credentialId, requireCredential("A-second"));
    assert.equal(audit.retryCount, 1);
  }

  return [chat, messages, countTokens];
}

async function restoreFirstCredential(): Promise<void> {
  await db
    .update(upstreamCredentials)
    .set({
      status: "active",
      coolUntil: null,
      errorCount: 0,
      lastError: null,
      lastErrorAt: null,
      updatedAt: new Date(),
    })
    .where(eq(upstreamCredentials.id, requireCredential("A-first")));
}

async function assertRetryFailureClassesStayBound(baseUrl: string): Promise<void> {
  for (const trap of ["http_401", "http_429", "network"] as const) {
    await restoreFirstCredential();
    firstCredentialTrap = trap;
    const firstCallsBefore = countCalls("A", "first");
    const secondCallsBefore = countCalls("A", "second");
    const bCallsBefore = countCalls("B");

    const result = await callApi(
      baseUrl,
      "/ai/chat/completions",
      "openai_chat",
      {
        model: sharedModel,
        messages: [{ role: "user", content: `hard binding ${trap}` }],
        stream: false,
      },
    );

    assert.equal(result.status, 200, `${trap} did not retry A/second`);
    assert.equal(countCalls("A", "first") - firstCallsBefore, 1);
    assert.equal(countCalls("A", "second") - secondCallsBefore, 1);
    assert.equal(countCalls("B"), bCallsBefore, `${trap} escaped to channel B`);

    const audit = await waitForAudit(result.requestId);
    assert.equal(audit.status, "success");
    assert.equal(audit.httpStatus, 200);
    assert.equal(audit.productLineId, requireProductLine("A"));
    assert.equal(audit.credentialId, requireCredential("A-second"));
    assert.equal(audit.retryCount, 1);
  }

  await restoreFirstCredential();
  firstCredentialTrap = "http_500";
  assertChannelBWasNeverCalled("401/429/5xx/network retry matrix");
}

async function assertDisabledBoundChannel(baseUrl: string): Promise<void> {
  const productLineA = requireProductLine("A");
  await db
    .update(productLines)
    .set({ status: "disabled", updatedAt: new Date() })
    .where(eq(productLines.id, productLineA));

  const callsBefore = upstreamCalls.length;
  const results = await Promise.all([
    callApi(
      baseUrl,
      "/ai/chat/completions",
      "openai_chat",
      {
        model: sharedModel,
        messages: [{ role: "user", content: "disabled A chat" }],
      },
    ),
    callApi(
      baseUrl,
      "/ai/v1/messages",
      "anthropic_messages",
      {
        model: sharedModel,
        max_tokens: 32,
        messages: [{ role: "user", content: "disabled A messages" }],
      },
    ),
  ]);

  for (const result of results) {
    assert.equal(result.status, 503);
    assert.equal(errorCode(result), "bound_channel_unavailable");
  }
  assert.equal(upstreamCalls.length, callsBefore, "disabled A still reached an upstream");
  assertChannelBWasNeverCalled("disabled bound channel failures");

  const audits = await Promise.all(results.map((result) => waitForAudit(result.requestId)));
  for (const audit of audits) {
    assert.equal(audit.productLineId, productLineA);
    assert.equal(audit.credentialId, null);
    assert.equal(audit.errorCode, "bound_channel_unavailable");
    assert.equal(audit.httpStatus, 503);
    assert.equal(audit.status, "upstream_error");
    assert.equal(audit.retryCount, 0);
  }
}

async function runAssertions(baseUrl: string): Promise<void> {
  await assertBoundModelLists(baseUrl);
  await assertProtocolEntrypoints(baseUrl);
  await assertRetryFailureClassesStayBound(baseUrl);
  await assertDisabledBoundChannel(baseUrl);
  assertChannelBWasNeverCalled("the complete hard-binding test");
  assert.deepEqual(mockFailures, []);

  console.log(JSON.stringify({
    ok: true,
    productLineA: requireProductLine("A"),
    productLineB: requireProductLine("B"),
    modelIsolation: true,
    protocolEntrypointsBoundToA: true,
    retryFailureClassesBoundToA: [401, 429, 500, "network"],
    aLocalRetries: countCalls("A", "first"),
    bCalls: countCalls("B"),
    disabledChannelAuditedToA: true,
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
    await db
      .delete(requestAuditBodies)
      .where(inArray(requestAuditBodies.requestId, [...trackedRequestIds]));
  }
  if (created.employeeId !== null) {
    await db.delete(requestAudits).where(eq(requestAudits.employeeId, created.employeeId));
    await db
      .delete(usageCountersDaily)
      .where(eq(usageCountersDaily.employeeId, created.employeeId));
  }

  await deleteIds(created.grantIds, (ids) =>
    db.delete(credentialEmployeeGrants).where(inArray(credentialEmployeeGrants.id, ids)));
  await deleteIds(created.apiKeyIds, (ids) =>
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

let primaryError: unknown = null;
try {
  assert.equal(await redis.ping(), "PONG", "configured Redis is unavailable");
  await assertMigratedDatabase();

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
      ? new AggregateError(
        [primaryError, ...cleanupErrors],
        "hard-binding integration test and cleanup failed",
      )
      : primaryError;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "hard-binding integration cleanup failed");
  }
}
